import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONFIG_REFERENCE,
  DEFAULT_DB_PATH,
  DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
  DEFAULT_PORT,
  DEFAULT_RPC_URL,
} from "../src/config.js";
import { REASON_TEXT } from "../src/errors.js";
import { ROUTES } from "../src/routeSchemas.js";

const CONFIG_SOURCE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/config.ts"),
  "utf8",
);

/**
 * CONFIG_REFERENCE is the single source docs/reference/config.md is generated
 * from (writing rule R3). These tests make drift between the table and
 * loadConfig a build failure rather than a documentation bug.
 */
describe("CONFIG_REFERENCE stays in lockstep with loadConfig", () => {
  const documented = new Set(
    CONFIG_REFERENCE.flatMap(entry => [entry.name, ...(entry.aliases ?? [])]),
  );

  it("documents every environment variable loadConfig reads", () => {
    const readCalls = [...CONFIG_SOURCE.matchAll(/read(?:Int)?\(env, "([A-Z_]+)"/g)].map(
      m => m[1],
    );
    expect(readCalls.length).toBeGreaterThan(0);
    for (const name of readCalls) {
      expect(documented, `loadConfig reads ${name} but CONFIG_REFERENCE omits it`).toContain(name);
    }
  });

  it("documents no variable loadConfig does not read", () => {
    for (const name of documented) {
      expect(
        CONFIG_SOURCE.includes(`"${name}"`),
        `CONFIG_REFERENCE documents ${name} but loadConfig never reads it`,
      ).toBe(true);
    }
  });

  it("renders defaults from the same constants the loader uses", () => {
    const byName = new Map(CONFIG_REFERENCE.map(entry => [entry.name, entry]));
    expect(byName.get("PORT")?.defaultValue).toBe(String(DEFAULT_PORT));
    expect(byName.get("DB_PATH")?.defaultValue).toBe(DEFAULT_DB_PATH);
    expect(byName.get("MAX_TRANSACTION_FEE_STROOPS")?.defaultValue).toBe(
      String(DEFAULT_MAX_TRANSACTION_FEE_STROOPS),
    );
    expect(byName.get("RPC_URL")?.defaultValue).toContain(DEFAULT_RPC_URL);
    expect(byName.get("SUBMITTER_SECRET")?.required).toBe("yes");
    expect(byName.get("SUBMITTER_SECRET")?.aliases).toContain("FACILITATOR_STELLAR_PRIVATE_KEY");
  });

  it("gives every entry a non-empty description and format", () => {
    for (const entry of CONFIG_REFERENCE) {
      expect(entry.description.length, entry.name).toBeGreaterThan(20);
      expect(entry.format.length, entry.name).toBeGreaterThan(0);
    }
  });
});

/**
 * ROUTES is the single source docs/api/openapi.yaml is generated from. The
 * walras_unknown_route reason text enumerates the mounted surface for callers,
 * so the two must name the same routes.
 */
describe("ROUTES stays in lockstep with the route inventory", () => {
  it("names every route the walras_unknown_route text advertises, and vice versa", () => {
    const advertised = REASON_TEXT.walras_unknown_route;
    for (const route of ROUTES) {
      expect(advertised, `walras_unknown_route text omits ${route.path}`).toContain(
        `${route.method} ${route.path}`,
      );
    }
    const mentioned = [...advertised.matchAll(/(GET|POST) (\/[a-z/]+)/g)];
    expect(mentioned.length).toBe(ROUTES.length);
  });

  it("has unique (method, path) pairs and complete metadata", () => {
    const seen = new Set<string>();
    for (const route of ROUTES) {
      const key = `${route.method} ${route.path}`;
      expect(seen.has(key), `duplicate route ${key}`).toBe(false);
      seen.add(key);
      expect(route.operationId.length, key).toBeGreaterThan(0);
      expect(route.summary.length, key).toBeGreaterThan(0);
      expect(route.schema.response[200], `${key} lacks a 200 response schema`).toBeDefined();
    }
  });
});
