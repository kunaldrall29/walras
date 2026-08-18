#!/usr/bin/env node
/**
 * Exports docs/api/openapi.yaml from the Fastify route schemas.
 *
 * Single source: `packages/facilitator/src/routeSchemas.ts` (writing rule R3) —
 * the same objects `buildServer` attaches to its routes. This script only maps
 * them into OpenAPI 3.1 structure; it invents no shapes. Canonical-spec humility
 * (R4): this document describes the walras surface; where behavior is
 * spec-mandated the schema descriptions cite the pinned spec path, and where it
 * is a walras choice they cite DECISIONS.md.
 *
 * Run via `pnpm docs:gen`. Requires `pnpm build` first (imports the dist).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = resolve(REPO_ROOT, "docs", "api", "openapi.yaml");

const { ROUTES, COMPONENT_SCHEMAS } = await import(
  resolve(REPO_ROOT, "packages/facilitator/dist/routeSchemas.js")
);

/** component schema object (by identity) → component name. */
const componentNames = new Map(Object.entries(COMPONENT_SCHEMAS).map(([name, s]) => [s, name]));

/**
 * Rewrites a schema tree, replacing any sub-schema that is identity-equal to a
 * named component with a $ref. The root itself is also replaceable — callers
 * that need the inline definition (the components section) pass `inlineRoot`.
 *
 * @param node - Schema node to rewrite.
 * @param inlineRoot - When true, the root node is emitted inline even if named.
 * @returns The rewritten node.
 */
function withRefs(node, inlineRoot = false) {
  if (Array.isArray(node)) return node.map(item => withRefs(item));
  if (node === null || typeof node !== "object") return node;
  if (!inlineRoot && componentNames.has(node)) {
    return { $ref: `#/components/schemas/${componentNames.get(node)}` };
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, withRefs(value)]));
}

/**
 * Maps a Fastify querystring object-schema to OpenAPI parameter objects.
 *
 * @param querystring - The route's querystring schema.
 * @returns OpenAPI parameter list.
 */
function toParameters(querystring) {
  if (!querystring) return [];
  const required = new Set(querystring.required ?? []);
  return Object.entries(querystring.properties ?? {}).map(([name, schema]) => {
    const { description, ...rest } = schema;
    return {
      name,
      in: "query",
      required: required.has(name),
      ...(description ? { description } : {}),
      schema: withRefs(rest),
    };
  });
}

const paths = {};
for (const route of ROUTES) {
  const operation = {
    operationId: route.operationId,
    summary: route.summary,
    description: route.description,
    tags: [...route.tags],
    responses: {},
  };

  const parameters = toParameters(route.schema.querystring);
  if (parameters.length > 0) operation.parameters = parameters;

  if (route.schema.body) {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: withRefs(route.schema.body) } },
    };
  }

  for (const [status, schema] of Object.entries(route.schema.response)) {
    const response = {
      description:
        status === "200"
          ? "See the schema description; a rejected payment is still a 200."
          : status === "400"
            ? "The request could not be interpreted; the body names why."
            : "Wrapper fault; never a statement about the payment's validity.",
      content: { "application/json": { schema: withRefs(schema) } },
    };
    const headers = route.responseHeaders?.[status];
    if (headers) {
      response.headers = Object.fromEntries(
        headers.map(h => [h.name, { description: h.description, schema: withRefs(h.schema) }]),
      );
    }
    operation.responses[status] = response;
  }

  paths[route.path] ??= {};
  paths[route.path][route.method.toLowerCase()] = operation;
}

const document = {
  openapi: "3.1.0",
  info: {
    title: "walras facilitator",
    version: "0.1.0",
    description:
      "x402 facilitator for Stellar with a settle-gated Bazaar discovery catalog. " +
      "This document is GENERATED from the Fastify route schemas " +
      "(packages/facilitator/src/routeSchemas.ts) by scripts/docs/gen-openapi.mjs — " +
      "do not edit by hand. It describes the walras surface; the x402 protocol " +
      "itself is canonical at x402-foundation/x402 @ " +
      "17fc9890ade45a570a019352a3573391ad5d1e1f.",
    license: { name: "Apache-2.0", identifier: "Apache-2.0" },
  },
  servers: [
    { url: "http://127.0.0.1:4021", description: "Local facilitator (default PORT)" },
  ],
  // Explicitly no authentication: RFP 3.1 leaves caller authentication as the
  // operator's design choice, and walras ships with an open surface — testnet
  // must be "free and usable without friction". A hosted mainnet deployment
  // would front this with its own auth layer; that is deployment, not protocol.
  security: [],
  tags: [
    { name: "payment", description: "x402 v2 spec section 7 payment surface" },
    { name: "discovery", description: "Bazaar discovery endpoints (specs/extensions/bazaar.md)" },
    { name: "operations", description: "walras-specific operational endpoints" },
  ],
  paths,
  components: {
    schemas: Object.fromEntries(
      Object.entries(COMPONENT_SCHEMAS).map(([name, schema]) => [name, withRefs(schema, true)]),
    ),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  "# GENERATED by scripts/docs/gen-openapi.mjs from packages/facilitator/src/routeSchemas.ts\n" +
    "# Do not edit. Regenerate with: pnpm docs:gen\n" +
    stringify(document, { lineWidth: 100 }),
);
console.log(`gen-openapi: wrote ${OUT} (${ROUTES.length} routes)`);
