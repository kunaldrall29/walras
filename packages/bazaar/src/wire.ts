import type { DiscoveryResource, DiscoveryResourcesResponse } from "@x402/extensions/bazaar";
import type { IndexOutcome } from "./indexer.js";
import type { CatalogListing, ListPage } from "./store.js";

/**
 * Wire-shape mapping: internal listings → the stock SDK's catalog types.
 *
 * The mapping target is `DiscoveryResource` exactly as `@x402/extensions`
 * defines it (FACTS F-050) — the shape a stock `withBazaar` client compiles
 * against. Per DECISIONS D-002, `lastUpdated` is the ISO 8601 string the SDK
 * type declares, not the v2 spec's conflicting Unix-timestamp example.
 */

/** The x402 protocol version stamped on discovery responses. */
const X402_VERSION = 2;

/**
 * Maps a stored listing to the spec/SDK wire shape.
 *
 * `ownerPayTo`, `toolName`, `firstSettledAt`, and `settleCount` are internal
 * bookkeeping and are deliberately not exposed: the wire type has no fields
 * for them, and additive fields here would invite clients to depend on
 * walras-only shape. (The MCP tuple key remains recoverable from
 * `extensions.bazaar.info.input.toolName`, which IS on the wire.)
 *
 * @param listing - The stored listing.
 * @returns The listing in `DiscoveryResource` shape.
 */
export function toDiscoveryResource(listing: CatalogListing): DiscoveryResource {
  const resource: DiscoveryResource = {
    resource: listing.resource,
    type: listing.type,
    x402Version: listing.x402Version,
    accepts: listing.accepts,
    lastUpdated: listing.lastSettledAt,
  };
  if (listing.description !== undefined) resource.description = listing.description;
  if (listing.mimeType !== undefined) resource.mimeType = listing.mimeType;
  if (listing.serviceName !== undefined) resource.serviceName = listing.serviceName;
  if (listing.tags !== undefined) resource.tags = listing.tags;
  if (listing.iconUrl !== undefined) resource.iconUrl = listing.iconUrl;
  if (listing.extensions !== undefined) resource.extensions = listing.extensions;
  return resource;
}

/**
 * Builds the `GET /discovery/resources` response body.
 *
 * List responses use `items` — never `resources`, which belongs to the search
 * endpoint (DECISIONS D-001; the asymmetry is deliberate and load-bearing for
 * stock clients). Pagination is `{limit, offset, total}` per F-027/F-028.
 *
 * @param page - The page returned by the store.
 * @returns The wire response body.
 */
export function toListResponse(page: ListPage): DiscoveryResourcesResponse {
  return {
    x402Version: X402_VERSION,
    items: page.items.map(toDiscoveryResource),
    pagination: {
      limit: page.limit,
      offset: page.offset,
      total: page.total,
    },
  };
}

/**
 * Encodes an indexing outcome as the `EXTENSION-RESPONSES` header value.
 *
 * Wire contract (FACTS F-024): base64-encoded JSON keyed by extension name;
 * `bazaar.status` ∈ success | processing | rejected; `rejectedReason` only
 * when rejected. Per DECISIONS D-014 a machine-readable `code` rides
 * alongside — additive, and within the stock client's log allowlist
 * (FACTS F-073).
 *
 * Returns undefined — meaning "send no header" — for outcomes the header
 * must not describe: nothing was cataloged because nothing was submitted
 * (`skipped`), or the indexer itself faulted (`error`, per D-015: a walras
 * fault is never reported as a client rejection; the header is a MAY and is
 * simply omitted). `processing` is never emitted because walras never
 * catalogs asynchronously.
 *
 * @param outcome - The indexing outcome.
 * @returns The header value, or undefined when no header should be sent.
 */
export function encodeExtensionResponses(outcome: IndexOutcome): string | undefined {
  let bazaar: Record<string, unknown>;
  switch (outcome.status) {
    case "indexed":
      bazaar = { status: "success" };
      break;
    case "rejected":
      bazaar = { status: "rejected", rejectedReason: outcome.reason, code: outcome.code };
      break;
    case "skipped":
    case "error":
      return undefined;
  }
  return Buffer.from(JSON.stringify({ bazaar }), "utf8").toString("base64");
}
