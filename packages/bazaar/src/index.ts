/**
 * @walras/bazaar — settle-gated discovery catalog for the walras facilitator.
 *
 * Three layers, deliberately transport-free so the facilitator package owns
 * all HTTP concerns:
 *
 *  - `store`   — SQLite (WAL) persistence keyed on (resource, type, toolName)
 *                per the spec's MCP tuple rule (FACTS F-029).
 *  - `indexer` — the trust boundary: validates hostile extension payloads,
 *                binds listing identity to the settled payment's verified
 *                payTo, never throws (DECISIONS D-015, D-024).
 *  - `wire`    — mapping to the stock SDK's `DiscoveryResource` shape and the
 *                `EXTENSION-RESPONSES` header encoding (FACTS F-024, F-050).
 */

export {
  BazaarStore,
  SCHEMA_SQL,
  clampLimit,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_SEARCH_RETRIEVE,
  MIN_LIST_LIMIT,
  type CatalogListing,
  type ListPage,
  type ListParams,
  type SearchPage,
  type SearchParams,
  type UpsertInput,
  type UpsertResult,
} from "./store.js";

export { indexSettledPayment, MAX_EXTENSIONS_BYTES, type IndexOutcome } from "./indexer.js";

export {
  encodeExtensionResponses,
  toDiscoveryResource,
  toListResponse,
  toSearchResponse,
} from "./wire.js";

// Search: the retriever seam (BASELINE: FTS5/BM25) and the cursor error the
// HTTP layer maps to a named 400. See docs/ARCHITECTURE.md §Search.
export {
  BM25_WEIGHTS,
  Fts5Retriever,
  MAX_QUERY_TOKENS,
  toFtsMatchExpression,
  type RankedHit,
  type Retriever,
} from "./retriever.js";
export { extractParamText } from "./searchtext.js";
export { InvalidCursorError } from "./cursor.js";

export { BAZAAR_REJECT_CODES, BAZAAR_REJECT_TEXT, type BazaarRejectCode } from "./reasons.js";

// Re-exported so the facilitator package needs no direct @x402/extensions
// dependency to advertise the extension key in /supported (DECISIONS D-016).
export { BAZAAR } from "@x402/extensions/bazaar";
