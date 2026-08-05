/**
 * Read-side access to the walras facilitator's discovery endpoints.
 *
 * Everything here speaks the spec wire shapes verified in Sessions 0–4:
 * search returns `resources` + `partialResults` + `{limit, cursor}`
 * (FACTS F-026 … F-028, F-077); list returns `items` + `{limit, offset,
 * total}` (F-027). The calling convention of a listing lives in
 * `extensions.bazaar` at the type-dependent locations of FACTS F-082.
 */

import { mintResourceId } from "./id.js";
import type { ResourceIdentity } from "./id.js";
import type { StructuredError } from "./errors.js";
import { facilitatorError, isFacilitatorCode, mcpError } from "./errors.js";

/** One payment option as it appears in a listing's accepts array. */
export interface WireAccepts {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

/** A catalog listing as the discovery endpoints serialize it (F-050). */
export interface WireListing {
  resource: string;
  type: string;
  x402Version: number;
  accepts: WireAccepts[];
  lastUpdated: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: {
    bazaar?: {
      info?: {
        input?: Record<string, unknown>;
        output?: Record<string, unknown>;
      };
      schema?: {
        properties?: {
          input?: {
            properties?: Record<string, unknown>;
          };
        };
      };
    };
  };
}

/** The machine-usable calling convention extracted from a listing (F-082). */
export interface CallingConvention {
  /** HTTP method, http listings only. */
  method: string | null;
  /** "json" when the http listing takes a request body. */
  bodyType: string | null;
  /** Example input values the seller declared (queryParams/body/example). */
  example: Record<string, unknown> | null;
  /** JSON Schema for the input, from the type-dependent location of F-082. */
  schema: Record<string, unknown> | null;
}

/** One entry of a search_resources result. Key order is the wire order. */
export interface SearchEntry {
  id: string;
  type: string;
  resource: string;
  toolName: string | null;
  name: string | null;
  description: string | null;
  price: WireAccepts | null;
  network: string | null;
  input: CallingConvention;
  lastUpdated: string;
}

/**
 * Recovers the MCP tool name from a listing's discovery extension.
 * HTTP listings yield the empty string (F-029 keying).
 *
 * @param listing - The wire listing.
 * @returns The tool name, or "" for HTTP resources.
 */
export function listingToolName(listing: WireListing): string {
  const input = listing.extensions?.bazaar?.info?.input;
  const toolName = input?.["toolName"];
  return typeof toolName === "string" ? toolName : "";
}

/**
 * Extracts the calling convention from a listing per FACTS F-082.
 *
 * HTTP: example values in `info.input.queryParams` (query variant) or
 * `info.input.body` (body variant); the JSON Schema in
 * `schema.properties.input.properties.queryParams` (resp. `.body`).
 * MCP: the JSON Schema is inline at `info.input.inputSchema`, the example at
 * `info.input.example`.
 *
 * @param listing - The wire listing.
 * @returns The extracted convention; fields are null when undeclared.
 */
export function callingConvention(listing: WireListing): CallingConvention {
  const info = listing.extensions?.bazaar?.info?.input ?? {};
  const schemaProps = listing.extensions?.bazaar?.schema?.properties?.input?.properties ?? {};

  const asObject = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  if (info["type"] === "mcp") {
    return {
      method: null,
      bodyType: null,
      example: asObject(info["example"]),
      schema: asObject(info["inputSchema"]),
    };
  }

  const bodyType = typeof info["bodyType"] === "string" ? (info["bodyType"] as string) : null;
  return {
    method: typeof info["method"] === "string" ? (info["method"] as string) : null,
    bodyType,
    example: asObject(bodyType !== null ? info["body"] : info["queryParams"]),
    schema: asObject(bodyType !== null ? schemaProps["body"] : schemaProps["queryParams"]),
  };
}

/**
 * Maps a wire listing to a search_resources entry, minting its id.
 *
 * @param listing - The wire listing.
 * @returns The deterministic entry exposed to MCP clients.
 */
export function toSearchEntry(listing: WireListing): SearchEntry {
  const toolName = listingToolName(listing);
  const price = listing.accepts.length > 0 ? listing.accepts[0] : null;
  return {
    id: mintResourceId({
      type: listing.type === "mcp" ? "mcp" : "http",
      resource: listing.resource,
      toolName,
    }),
    type: listing.type,
    resource: listing.resource,
    toolName: toolName === "" ? null : toolName,
    name: listing.serviceName ?? null,
    description: listing.description ?? null,
    price:
      price === null
        ? null
        : {
            scheme: price.scheme,
            network: price.network,
            asset: price.asset,
            amount: price.amount,
            payTo: price.payTo,
          },
    network: price?.network ?? null,
    input: callingConvention(listing),
    lastUpdated: listing.lastUpdated,
  };
}

/** Discriminated result for catalog calls: a value or a structured error. */
export type CatalogResult<T> = { ok: T; err?: never } | { ok?: never; err: StructuredError };

/**
 * Interprets a non-200 discovery response into a structured error,
 * passing facilitator codes through verbatim (D-028 taxonomy 1).
 *
 * @param status - The HTTP status the facilitator answered with.
 * @param bodyText - The raw response body.
 * @returns The structured error to surface.
 */
function discoveryError(status: number, bodyText: string): StructuredError {
  try {
    const body = JSON.parse(bodyText) as { error?: { code?: unknown; reason?: unknown } };
    const code = body.error?.code;
    if (typeof code === "string" && isFacilitatorCode(code)) {
      const reason = body.error?.reason;
      return facilitatorError(code, typeof reason === "string" ? reason : undefined);
    }
  } catch {
    // fall through — not the facilitator's error envelope
  }
  return mcpError("walras_mcp_search_failed", `HTTP ${status}: ${bodyText.slice(0, 300)}`);
}

/** Wire shape of GET /discovery/search (F-026 … F-028). */
interface WireSearchResponse {
  resources: WireListing[];
  partialResults: boolean;
  pagination: { limit: number; cursor: string | null } | null;
}

/** Filters accepted by searchCatalog, mirroring the endpoint's parameters. */
export interface SearchFilters {
  type?: string;
  network?: string;
  scheme?: string;
  payTo?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Runs GET /discovery/search against the facilitator.
 *
 * @param fetchImpl - The fetch implementation to use.
 * @param facilitatorUrl - Base URL of the walras facilitator.
 * @param query - The search query (required by the endpoint, F-026).
 * @param filters - Optional filters, forwarded verbatim.
 * @returns The wire response, or a structured error.
 */
export async function searchCatalog(
  fetchImpl: typeof fetch,
  facilitatorUrl: string,
  query: string,
  filters: SearchFilters,
): Promise<CatalogResult<WireSearchResponse>> {
  const url = new URL("/discovery/search", facilitatorUrl);
  url.searchParams.set("query", query);
  if (filters.type !== undefined) url.searchParams.set("type", filters.type);
  if (filters.network !== undefined) url.searchParams.set("network", filters.network);
  if (filters.scheme !== undefined) url.searchParams.set("scheme", filters.scheme);
  if (filters.payTo !== undefined) url.searchParams.set("payTo", filters.payTo);
  if (filters.limit !== undefined) url.searchParams.set("limit", String(filters.limit));
  if (filters.cursor !== undefined) url.searchParams.set("cursor", filters.cursor);

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    return {
      err: mcpError(
        "walras_mcp_facilitator_unreachable",
        `GET ${url.pathname} against ${facilitatorUrl}: ${(error as Error).message}`,
      ),
    };
  }
  const bodyText = await response.text();
  if (response.status !== 200) return { err: discoveryError(response.status, bodyText) };

  try {
    return { ok: JSON.parse(bodyText) as WireSearchResponse };
  } catch {
    return { err: mcpError("walras_mcp_search_failed", "search returned unparseable JSON.") };
  }
}

/** How many list pages findListing walks before giving up (100 items each). */
const MAX_LIST_PAGES = 10;

/**
 * Finds one listing by its identity tuple by walking GET /discovery/resources.
 *
 * The list endpoint has no by-id lookup (the spec defines none), so this
 * walks pages filtered by `type` until the tuple matches. Bounded at
 * MAX_LIST_PAGES × 100 listings — far beyond pre-build catalog scale; the
 * bound is logged in the error when hit rather than silently truncating.
 *
 * @param fetchImpl - The fetch implementation to use.
 * @param facilitatorUrl - Base URL of the walras facilitator.
 * @param identity - The tuple to find.
 * @returns The listing, or a structured error (unknown id / unreachable).
 */
export async function findListing(
  fetchImpl: typeof fetch,
  facilitatorUrl: string,
  identity: ResourceIdentity,
): Promise<CatalogResult<WireListing>> {
  const pageSize = 100;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const url = new URL("/discovery/resources", facilitatorUrl);
    url.searchParams.set("type", identity.type);
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(page * pageSize));

    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      return {
        err: mcpError(
          "walras_mcp_facilitator_unreachable",
          `GET ${url.pathname} against ${facilitatorUrl}: ${(error as Error).message}`,
        ),
      };
    }
    const bodyText = await response.text();
    if (response.status !== 200) return { err: discoveryError(response.status, bodyText) };

    let body: { items: WireListing[]; pagination: { total: number } };
    try {
      body = JSON.parse(bodyText) as typeof body;
    } catch {
      return { err: mcpError("walras_mcp_search_failed", "list returned unparseable JSON.") };
    }

    const match = body.items.find(
      item => item.resource === identity.resource && listingToolName(item) === identity.toolName,
    );
    if (match !== undefined) return { ok: match };
    if ((page + 1) * pageSize >= body.pagination.total) break;
  }
  return {
    err: mcpError(
      "walras_mcp_unknown_resource_id",
      `No ${identity.type} listing for ${identity.resource}` +
        (identity.toolName === "" ? "" : ` (tool ${identity.toolName})`) +
        ` within the first ${MAX_LIST_PAGES * pageSize} catalog entries.`,
    ),
  };
}
