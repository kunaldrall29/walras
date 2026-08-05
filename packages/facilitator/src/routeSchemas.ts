/**
 * Route schemas — the single source for the facilitator's HTTP surface.
 *
 * These JSON Schema objects are attached to the Fastify routes in `server.ts` and are
 * the input `scripts/docs/gen-openapi.mjs` exports `docs/api/openapi.yaml` from. They
 * exist once, here; the OpenAPI document is generated, never hand-written (writing
 * rule R3 — drift prevention).
 *
 * They are documentation-grade, not enforcement: `buildServer` installs no-op
 * validator and serializer compilers, so attaching a schema changes no runtime
 * behavior — request validation stays in the handlers (which emit named
 * `walras_*` rejections rather than Fastify's generic 400s), and responses are
 * serialized with plain `JSON.stringify` exactly as before. A schema here that
 * tried to enforce anything would shadow the handler's own error model
 * (DECISIONS D-007). `test/route-schemas.test.ts` pins both properties: every
 * route carries its schema, and the wire behavior is unchanged by their presence.
 *
 * Shape sources, all at the pinned spec SHA `17fc9890ade45a570a019352a3573391ad5d1e1f`:
 * request/response envelopes from `specs/x402-specification-v2.md` §7 (FACTS F-040)
 * as compiled into `@x402/core`'s TypeScript types; discovery shapes from
 * `specs/extensions/bazaar.md` (FACTS F-025 … F-028, F-050); settle receipt from
 * the exact-Stellar scheme spec (FACTS F-038). Where our behavior is a choice rather
 * than a spec mandate, the description says so and cites DECISIONS.
 */

/** A JSON Schema object. Deliberately loose — these are data, not TS types. */
export type SchemaObject = Record<string, unknown>;

const PINNED_SHA = "17fc9890ade45a570a019352a3573391ad5d1e1f";

// ---------------------------------------------------------------------------
// Component schemas — shared shapes, referenced by identity from the routes.
// The OpenAPI generator maps each of these JS objects to a named component.
// ---------------------------------------------------------------------------

/** `PaymentRequirements` as `@x402/core` types it (spec §5 @ pinned SHA). */
export const PAYMENT_REQUIREMENTS_SCHEMA: SchemaObject = {
  type: "object",
  description:
    `One entry of a 402 response's accepts array, echoed back to the facilitator ` +
    `verbatim. Shape per specs/x402-specification-v2.md @ ${PINNED_SHA} as compiled ` +
    `into @x402/core's PaymentRequirements type.`,
  required: ["scheme", "network", "asset", "amount", "payTo", "maxTimeoutSeconds"],
  additionalProperties: true,
  properties: {
    scheme: {
      type: "string",
      description: "Payment scheme identifier. This deployment serves 'exact' (FACTS F-041).",
    },
    network: {
      type: "string",
      description:
        "CAIP-2 network identifier, e.g. 'stellar:testnet' (FACTS F-004).",
    },
    asset: {
      type: "string",
      description:
        "Token contract address. On Stellar: a SEP-41 Soroban contract ID (C...); " +
        "USDC testnet SAC is FACTS F-052.",
    },
    amount: {
      type: "string",
      description: "Amount in base units of the asset (USDC: 7 decimals, FACTS F-008).",
    },
    payTo: {
      type: "string",
      description: "Recipient address the settled transfer must credit (FACTS F-035).",
    },
    maxTimeoutSeconds: {
      type: "number",
      description:
        "Upper bound on payment validity; the scheme derives the auth-entry ledger " +
        "bound from it (FACTS F-034).",
    },
    extra: { type: "object", additionalProperties: true },
  },
};

/**
 * The request body `POST /verify` and `POST /settle` share — spec §7.1/§7.2
 * @ pinned SHA, exactly what the stock `@x402/core` facilitator client sends.
 */
export const FACILITATOR_REQUEST_SCHEMA: SchemaObject = {
  type: "object",
  description:
    `Facilitator request envelope per specs/x402-specification-v2.md §7.1/§7.2 @ ` +
    `${PINNED_SHA}. walras validates only this envelope; every payment-level rule ` +
    `is enforced by @x402/stellar's ExactStellarScheme (FACTS F-045), so rejections ` +
    `carry the scheme's own reason codes (DECISIONS D-007).`,
  required: ["paymentPayload", "paymentRequirements"],
  additionalProperties: true,
  properties: {
    x402Version: {
      type: "integer",
      description:
        "Top-level protocol version. Informational: routing keys on " +
        "paymentPayload.x402Version, which is what the facilitator core registers " +
        "schemes against.",
    },
    paymentPayload: {
      type: "object",
      description:
        "The client's PaymentPayload: {x402Version, resource?, accepted, payload, " +
        "extensions?}. For exact on Stellar, payload is exactly " +
        '{"transaction": "<base64 XDR>"} (FACTS F-033). A bazaar extension echoed ' +
        "here is what triggers automatic cataloging on settle (FACTS F-032).",
      additionalProperties: true,
    },
    paymentRequirements: PAYMENT_REQUIREMENTS_SCHEMA,
  },
};

/** `VerifyResponse` — spec §7.1 @ pinned SHA / `@x402/core` type. */
export const VERIFY_RESPONSE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    "Verification outcome. A rejected payment is a 200 carrying isValid: false — a " +
    "successful exchange about an invalid payment (matching the reference " +
    "facilitator); 4xx is reserved for requests that could not be interpreted as an " +
    "x402 exchange at all, rendered in this same shape so the stock client's " +
    "VerifyError still carries the machine-readable code.",
  required: ["isValid"],
  additionalProperties: true,
  properties: {
    isValid: { type: "boolean" },
    invalidReason: {
      type: "string",
      description:
        "Machine-readable reason code, present exactly when isValid is false: one of " +
        "the 37 codes inherited from @x402/stellar or the walras_* envelope codes " +
        "(FACTS F-045; DECISIONS D-007). Full registry: docs/reference/errors.md.",
    },
    invalidMessage: {
      type: "string",
      description:
        "Non-null human-readable explanation, backfilled by walras when the scheme " +
        "leaves it empty (RFP 3.6). An explanation, never a machine contract — " +
        "branch on invalidReason.",
    },
    payer: { type: "string", description: "The paying address, when recoverable." },
    extensions: { type: "object", additionalProperties: true },
    extra: { type: "object", additionalProperties: true },
  },
};

/** `SettleResponse` — spec §7.2 @ pinned SHA / FACTS F-038. */
export const SETTLE_RESPONSE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    "Settlement outcome. Same 200-on-rejection convention as /verify: " +
    "success: false with errorReason names why the payment failed.",
  required: ["success", "transaction", "network"],
  additionalProperties: true,
  properties: {
    success: { type: "boolean" },
    transaction: {
      type: "string",
      description:
        "The 64-character hex Stellar transaction hash on success (FACTS F-038); " +
        "the empty string on failure (spec §5.3.2).",
    },
    network: { type: "string", description: "CAIP-2 network the settlement ran on." },
    payer: {
      type: "string",
      description: "The client's address — never the facilitator's (FACTS F-038).",
    },
    errorReason: {
      type: "string",
      description:
        "Machine-readable reason code, present exactly when success is false " +
        "(FACTS F-045; DECISIONS D-007). Full registry: docs/reference/errors.md.",
    },
    errorMessage: {
      type: "string",
      description: "Non-null human-readable explanation on failure (RFP 3.6).",
    },
    extensions: { type: "object", additionalProperties: true },
    extra: { type: "object", additionalProperties: true },
  },
};

/** `GET /supported` response — spec §7.3 @ pinned SHA (FACTS F-040). */
export const SUPPORTED_RESPONSE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    `Capability advertisement per specs/x402-specification-v2.md §7.3 @ ${PINNED_SHA}: ` +
    "all three fields are required (FACTS F-040).",
  required: ["kinds", "extensions", "signers"],
  additionalProperties: true,
  properties: {
    kinds: {
      type: "array",
      description: "Payment kinds this facilitator serves.",
      items: {
        type: "object",
        required: ["x402Version", "scheme", "network"],
        additionalProperties: true,
        properties: {
          x402Version: { type: "integer" },
          scheme: { type: "string" },
          network: { type: "string" },
          extra: {
            type: "object",
            additionalProperties: true,
            description:
              "Scheme extra contract. The Stellar kind carries " +
              "extra.areFeesSponsored: true — network fees are sponsored by the " +
              "facilitator's submitter accounts (FACTS F-006, F-041).",
          },
        },
      },
    },
    extensions: {
      type: "array",
      items: { type: "string" },
      description:
        "Extension identifiers with a reachable implementation behind them. walras " +
        "lists 'bazaar' because the discovery endpoints are mounted (DECISIONS D-016).",
    },
    signers: {
      type: "object",
      additionalProperties: { type: "array", items: { type: "string" } },
      description:
        "CAIP-2 pattern (e.g. 'stellar:*') → the public addresses that source " +
        "settlement transactions (FACTS F-040).",
    },
  },
};

/** One catalog listing — the SDK's `DiscoveryResource` shape (FACTS F-050). */
export const DISCOVERY_RESOURCE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    "A catalog listing in the stock SDK's DiscoveryResource wire shape " +
    "(FACTS F-050) — what an unmodified withBazaar client compiles against. " +
    "Every listing exists because a payment settled on-chain through this " +
    "facilitator (settle-gated cataloging, DECISIONS D-004 — a policy, not a spec " +
    "mandate, F-023).",
  required: ["resource", "type", "x402Version", "accepts", "lastUpdated"],
  additionalProperties: true,
  properties: {
    resource: {
      type: "string",
      description:
        "Canonical resource URL: origin + routeTemplate when a valid template was " +
        "declared, else origin + pathname; query and fragment stripped (FACTS F-051).",
    },
    type: {
      type: "string",
      description:
        "Resource type, e.g. 'http' or 'mcp'. MCP listings are keyed on the " +
        "(resource.url, toolName) tuple per the spec's MUST (FACTS F-029); the " +
        "toolName is inside extensions.bazaar.info.input.",
    },
    x402Version: { type: "integer" },
    accepts: {
      type: "array",
      items: PAYMENT_REQUIREMENTS_SCHEMA,
      description:
        "Payment requirements observed at settle time. Advisory: a buyer always pays " +
        "against the live 402 from the resource server itself (DECISIONS D-024).",
    },
    lastUpdated: {
      type: "string",
      description:
        "ISO 8601 timestamp of the last settlement that touched this listing. The " +
        "SDK type says ISO 8601 while the v2 spec's example shows a Unix number; " +
        "walras follows the SDK type stock clients compile against (DECISIONS D-002).",
    },
    description: { type: "string" },
    mimeType: { type: "string" },
    serviceName: {
      type: "string",
      description: "Soft-drop validated: printable ASCII, ≤ 32 chars (FACTS F-031).",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description:
        "Soft-drop validated: ≤ 5 entries, each ≤ 32 printable-ASCII chars, deduped " +
        "case-insensitively (FACTS F-031).",
    },
    iconUrl: {
      type: "string",
      description:
        "Soft-drop validated: absolute http(s), no userinfo, hostile-host checks " +
        "with percent-decoding before IP/loopback tests (FACTS F-031).",
    },
    extensions: {
      type: "object",
      additionalProperties: true,
      description:
        "The echoed bazaar extension, including info.input — the machine-readable " +
        "calling convention (FACTS F-082).",
    },
  },
};

/** `GET /discovery/resources` response (FACTS F-025, F-027). */
export const DISCOVERY_LIST_RESPONSE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    "Catalog page. The array field is named items — never resources, which belongs " +
    "to the search endpoint; the asymmetry is the SDK types' and is load-bearing " +
    "for stock clients (FACTS F-027, DECISIONS D-001).",
  required: ["x402Version", "items", "pagination"],
  additionalProperties: true,
  properties: {
    x402Version: { type: "integer" },
    items: { type: "array", items: DISCOVERY_RESOURCE_SCHEMA },
    pagination: {
      type: "object",
      required: ["limit", "offset", "total"],
      additionalProperties: true,
      properties: {
        limit: { type: "integer", description: "The limit this page was served with." },
        offset: { type: "integer", description: "The offset this page starts at." },
        total: { type: "integer", description: "Total listings matching the filters." },
      },
    },
  },
};

/** `GET /discovery/search` response (FACTS F-026 … F-028, F-077). */
export const DISCOVERY_SEARCH_RESPONSE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    "Ranked search results. The array field is named resources — never items " +
    "(FACTS F-027, DECISIONS D-001). partialResults and pagination are emitted on " +
    "every response even though the spec makes them optional, so a client never has " +
    "to guess whether an absent flag means complete or unimplemented (DECISIONS D-027).",
  required: ["x402Version", "resources", "partialResults", "pagination"],
  additionalProperties: true,
  properties: {
    x402Version: { type: "integer" },
    resources: {
      type: "array",
      items: DISCOVERY_RESOURCE_SCHEMA,
      description: "Best-first: BM25 relevance, most-relevant first (FACTS F-076).",
    },
    partialResults: {
      type: "boolean",
      description:
        "True exactly when matches were truncated from this response: a further page " +
        "exists, or retrieval hit its cap (FACTS F-028; DECISIONS D-027).",
    },
    pagination: {
      type: "object",
      required: ["limit", "cursor"],
      additionalProperties: true,
      properties: {
        limit: {
          type: "integer",
          description:
            "Number of results in THIS page — the returned count, not the requested " +
            "maximum; the spec's literal reading, which differs from the list " +
            "endpoint's semantics (FACTS F-077).",
        },
        cursor: {
          type: ["string", "null"],
          description:
            "Opaque cursor for the next page; null on the final page. Bound to its " +
            "(query, filters) context — replaying it against a different query is a " +
            "named 400, walras_invalid_search_cursor (DECISIONS D-027).",
        },
      },
    },
  },
};

/** The `{error: {code, reason}}` envelope for non-payment error responses. */
export const ERROR_ENVELOPE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    "Error envelope for requests outside the payment exchange (discovery query " +
    "errors, unknown routes). Payment-path rejections never use this shape — they " +
    "are rendered as VerifyResponse/SettleResponse so stock clients keep the code.",
  required: ["error"],
  additionalProperties: true,
  properties: {
    error: {
      type: "object",
      required: ["code", "reason"],
      additionalProperties: true,
      properties: {
        code: {
          type: "string",
          description: "Machine-readable walras_* code (docs/reference/errors.md).",
        },
        reason: { type: "string", description: "Non-null human-readable explanation." },
      },
    },
  },
};

/** `GET /health` response — walras-specific, not part of x402. */
export const HEALTH_RESPONSE_SCHEMA: SchemaObject = {
  type: "object",
  description:
    "Operational readiness plus the log-safe configuration projection " +
    "(describeConfig — public addresses, never seeds). Not part of the x402 surface.",
  required: ["status", "x402Version", "network"],
  additionalProperties: true,
  properties: {
    status: { type: "string", enum: ["ok"] },
    x402Version: { type: "integer" },
    network: { type: "string" },
    rpcUrl: { type: "string" },
    submitters: {
      type: "array",
      items: { type: "string" },
      description: "Public addresses of the configured submitter accounts.",
    },
    feeBumpAddress: {
      type: ["string", "null"],
      description: "Fee-bump account public address, or null when not configured.",
    },
    port: { type: "integer" },
    feeMode: { type: "string" },
    dbPath: { type: "string" },
    maxTransactionFeeStroops: { type: "integer" },
  },
};

/**
 * OpenAPI component name → schema object. The generator replaces any sub-schema
 * that is identity-equal to one of these values with a `$ref` to its name.
 */
export const COMPONENT_SCHEMAS: Record<string, SchemaObject> = {
  PaymentRequirements: PAYMENT_REQUIREMENTS_SCHEMA,
  FacilitatorRequest: FACILITATOR_REQUEST_SCHEMA,
  VerifyResponse: VERIFY_RESPONSE_SCHEMA,
  SettleResponse: SETTLE_RESPONSE_SCHEMA,
  SupportedResponse: SUPPORTED_RESPONSE_SCHEMA,
  DiscoveryResource: DISCOVERY_RESOURCE_SCHEMA,
  DiscoveryListResponse: DISCOVERY_LIST_RESPONSE_SCHEMA,
  DiscoverySearchResponse: DISCOVERY_SEARCH_RESPONSE_SCHEMA,
  ErrorEnvelope: ERROR_ENVELOPE_SCHEMA,
  HealthResponse: HEALTH_RESPONSE_SCHEMA,
};

// ---------------------------------------------------------------------------
// Query-string schemas
// ---------------------------------------------------------------------------

const LIST_FILTER_PROPERTIES: Record<string, SchemaObject> = {
  type: {
    type: "string",
    description: "Filter by resource type, e.g. 'http' or 'mcp' (FACTS F-025).",
  },
  payTo: { type: "string", description: "Filter by the listing's verified payTo address." },
  scheme: {
    type: "string",
    description:
      "Filter by payment scheme, e.g. 'exact'. Present in the spec and SDK but " +
      "omitted from the RFP's prose enumeration (FACTS F-025; DECISIONS D-005).",
  },
  network: { type: "string", description: "Filter by CAIP-2 network." },
  extensions: { type: "string", description: "Filter by extension identifier." },
};

const LIST_QUERYSTRING_SCHEMA: SchemaObject = {
  type: "object",
  additionalProperties: true,
  properties: {
    ...LIST_FILTER_PROPERTIES,
    limit: {
      type: "integer",
      description:
        "Page size. Default 20; out-of-range values are clamped to [1, 100] rather " +
        "than rejected — the spec's documented defaults (FACTS F-025). Non-numeric " +
        "values are a named 400 (walras_invalid_query_parameter).",
    },
    offset: {
      type: "integer",
      description: "Page start. Default 0. Non-numeric values are a named 400.",
    },
  },
};

const SEARCH_QUERYSTRING_SCHEMA: SchemaObject = {
  type: "object",
  required: ["query"],
  additionalProperties: true,
  properties: {
    query: {
      type: "string",
      description:
        "Natural-language query. Required, and named query — not q (FACTS F-026; " +
        "DECISIONS D-006). Missing or blank is a named 400, walras_missing_search_query. " +
        "Hostile FTS syntax is safe: queries are compiled to quoted-token expressions " +
        "before reaching the engine (FACTS F-076).",
    },
    ...LIST_FILTER_PROPERTIES,
    limit: {
      type: "integer",
      description: "Requested page size. Default 20, clamped to [1, 100] (DECISIONS D-027).",
    },
    cursor: {
      type: "string",
      description:
        "Opaque cursor from a previous response's pagination.cursor. A cursor minted " +
        "for a different query/filter combination is a named 400, " +
        "walras_invalid_search_cursor (DECISIONS D-027).",
    },
  },
};

// ---------------------------------------------------------------------------
// The route table
// ---------------------------------------------------------------------------

/** Extra response-header documentation, consumed only by the OpenAPI generator. */
export interface ResponseHeaderDoc {
  name: string;
  description: string;
  schema: SchemaObject;
}

/** One route: what Fastify mounts and what the OpenAPI generator documents. */
export interface RouteDescriptor {
  method: "GET" | "POST";
  path: string;
  operationId: string;
  summary: string;
  description: string;
  tags: readonly string[];
  schema: {
    body?: SchemaObject;
    querystring?: SchemaObject;
    response: Record<number, SchemaObject>;
  };
  /** status → documented response headers (OpenAPI only; Fastify ignores this). */
  responseHeaders?: Record<number, readonly ResponseHeaderDoc[]>;
}

export const VERIFY_ROUTE: RouteDescriptor = {
  method: "POST",
  path: "/verify",
  operationId: "verify",
  summary: "Verify a payment without broadcasting it",
  description:
    `x402 v2 spec §7.1 @ ${PINNED_SHA}. The scheme runs the full verification MUST ` +
    "list — structure, simulation, events, auth entries, facilitator safety " +
    "(FACTS F-035) — and every rejection carries a machine-readable code plus a " +
    "non-null human-readable reason.",
  tags: ["payment"],
  schema: {
    body: FACILITATOR_REQUEST_SCHEMA,
    response: {
      200: VERIFY_RESPONSE_SCHEMA,
      400: VERIFY_RESPONSE_SCHEMA,
      500: VERIFY_RESPONSE_SCHEMA,
    },
  },
};

export const SETTLE_ROUTE: RouteDescriptor = {
  method: "POST",
  path: "/settle",
  operationId: "settle",
  summary: "Settle a payment on-chain",
  description:
    `x402 v2 spec §7.2 @ ${PINNED_SHA}. Settle verifies independently — the spec ` +
    "requires it and the scheme runs the full verify as its first step, so walras " +
    "adds no wrapper-level pre-verify (FACTS F-036). On success, the settle-gated " +
    "cataloging hook runs off the settlement path (DECISIONS D-004, D-015) and " +
    "reports its outcome in the EXTENSION-RESPONSES header (FACTS F-024).",
  tags: ["payment"],
  schema: {
    body: FACILITATOR_REQUEST_SCHEMA,
    response: {
      200: SETTLE_RESPONSE_SCHEMA,
      400: SETTLE_RESPONSE_SCHEMA,
      500: SETTLE_RESPONSE_SCHEMA,
    },
  },
  responseHeaders: {
    200: [
      {
        name: "EXTENSION-RESPONSES",
        description:
          "Base64-encoded JSON keyed by extension name (FACTS F-024). " +
          'bazaar.status is "success" or "rejected"; rejections carry the ' +
          "human-readable rejectedReason plus an additive machine code " +
          "(DECISIONS D-014, D-025). Omitted when nothing was submitted for " +
          "cataloging or on an internal indexer fault.",
        schema: { type: "string" },
      },
    ],
  },
};

export const SUPPORTED_ROUTE: RouteDescriptor = {
  method: "GET",
  path: "/supported",
  operationId: "getSupported",
  summary: "Advertise kinds, extensions, and signers",
  description:
    `x402 v2 spec §7.3 @ ${PINNED_SHA} (FACTS F-040). The Stellar kind carries ` +
    "extra.areFeesSponsored: true (FACTS F-041); 'bazaar' appears in extensions " +
    "because the discovery endpoints are reachable (DECISIONS D-016).",
  tags: ["payment"],
  schema: {
    response: { 200: SUPPORTED_RESPONSE_SCHEMA },
  },
};

export const DISCOVERY_RESOURCES_ROUTE: RouteDescriptor = {
  method: "GET",
  path: "/discovery/resources",
  operationId: "listDiscoveryResources",
  summary: "Browse the settle-gated resource catalog",
  description:
    `specs/extensions/bazaar.md @ ${PINNED_SHA}. Seven filters — type, payTo, ` +
    "scheme, network, extensions, limit, offset (FACTS F-025; the RFP's prose " +
    "omits scheme, DECISIONS D-005). Response uses items + {limit, offset, total} " +
    "pagination (FACTS F-027).",
  tags: ["discovery"],
  schema: {
    querystring: LIST_QUERYSTRING_SCHEMA,
    response: {
      200: DISCOVERY_LIST_RESPONSE_SCHEMA,
      400: ERROR_ENVELOPE_SCHEMA,
      500: ERROR_ENVELOPE_SCHEMA,
    },
  },
};

export const DISCOVERY_SEARCH_ROUTE: RouteDescriptor = {
  method: "GET",
  path: "/discovery/search",
  operationId: "searchDiscoveryResources",
  summary: "Rank the catalog against a natural-language query",
  description:
    `specs/extensions/bazaar.md @ ${PINNED_SHA}. Required query parameter plus the ` +
    "same five filters as the list endpoint (FACTS F-026). Real keyset cursor " +
    "pagination and a truthful partialResults — deliberate over-delivery against " +
    "the spec's advisory MAY (DECISIONS D-003, D-027). Ranking is the BASELINE " +
    "FTS5/BM25 retriever (DECISIONS D-026).",
  tags: ["discovery"],
  schema: {
    querystring: SEARCH_QUERYSTRING_SCHEMA,
    response: {
      200: DISCOVERY_SEARCH_RESPONSE_SCHEMA,
      400: ERROR_ENVELOPE_SCHEMA,
      500: ERROR_ENVELOPE_SCHEMA,
    },
  },
};

export const HEALTH_ROUTE: RouteDescriptor = {
  method: "GET",
  path: "/health",
  operationId: "getHealth",
  summary: "Operational readiness",
  description:
    "walras-specific; not part of the x402 surface. Reports the log-safe " +
    "configuration projection: public addresses only, never seeds.",
  tags: ["operations"],
  schema: {
    response: { 200: HEALTH_RESPONSE_SCHEMA },
  },
};

/** Every route this facilitator mounts, in mount order. */
export const ROUTES: readonly RouteDescriptor[] = [
  VERIFY_ROUTE,
  SETTLE_ROUTE,
  DISCOVERY_RESOURCES_ROUTE,
  DISCOVERY_SEARCH_ROUTE,
  SUPPORTED_ROUTE,
  HEALTH_ROUTE,
];
