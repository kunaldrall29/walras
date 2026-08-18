/**
 * Test helpers: fixture listings in the exact discovery wire shape
 * (FACTS F-050, F-082), fetch doubles, and an in-memory MCP client session
 * over the real protocol (linked InMemoryTransport pair).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildMcpServer } from "../src/server.js";
import type { McpServerDeps } from "../src/server.js";
import type { WireListing } from "../src/catalog.js";

/** Testnet USDC SAC (FACTS F-052); any SEP-41 contract id works for doubles. */
export const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const SELLER = "GBSELLERSELLERSELLERSELLERSELLERSELLERSELLERSELLERSELLER";

/** An http-typed listing with a GET/queryParams calling convention. */
export function httpListing(overrides: Partial<WireListing> = {}): WireListing {
  return {
    resource: "http://127.0.0.1:4022/weather",
    type: "http",
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "stellar:testnet",
        asset: USDC,
        amount: "100000",
        payTo: SELLER,
      },
    ],
    lastUpdated: "2026-08-03T10:00:00.000Z",
    description: "Current weather for a city",
    mimeType: "application/json",
    serviceName: "Weather Service",
    tags: ["weather"],
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "http",
            method: "GET",
            queryParams: { city: "Zurich", units: "metric" },
          },
          output: { type: "json", example: { tempC: 21 } },
        },
        schema: {
          properties: {
            input: {
              properties: {
                queryParams: {
                  type: "object",
                  properties: { city: { type: "string" }, units: { type: "string" } },
                  required: ["city"],
                },
              },
            },
          },
        },
      },
    },
    ...overrides,
  };
}

/** An mcp-typed listing with an inline inputSchema (F-082). */
export function mcpListing(overrides: Partial<WireListing> = {}): WireListing {
  return {
    resource: "http://127.0.0.1:4023/mcp",
    type: "mcp",
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "stellar:testnet",
        asset: USDC,
        amount: "200000",
        payTo: SELLER,
      },
    ],
    lastUpdated: "2026-08-03T11:00:00.000Z",
    description: "Greets a person by name",
    serviceName: "Hello Tool",
    extensions: {
      bazaar: {
        info: {
          input: {
            type: "mcp",
            toolName: "hello",
            inputSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
            example: { name: "Ada" },
          },
          output: { type: "json", example: { greeting: "hi Ada" } },
        },
      },
    },
    ...overrides,
  };
}

/** Builds a spec-shaped search response body (F-026 … F-028). */
export function searchBody(listings: WireListing[], cursor: string | null = null): string {
  return JSON.stringify({
    x402Version: 2,
    resources: listings,
    partialResults: cursor !== null,
    pagination: { limit: listings.length, cursor },
  });
}

/** Builds a spec-shaped list response body (F-027). */
export function listBody(listings: WireListing[], total = listings.length): string {
  return JSON.stringify({
    x402Version: 2,
    items: listings,
    pagination: { limit: 100, offset: 0, total },
  });
}

/** A fetch double routed by pathname; records every request it serves. */
export function fetchDouble(
  routes: Record<string, (url: URL, init?: RequestInit) => Response | Promise<Response>>,
): { impl: typeof fetch; calls: Array<{ url: URL; init?: RequestInit }> } {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push({ url, init });
    const route = routes[url.pathname];
    if (route === undefined) throw new Error(`fetch double: no route for ${url.pathname}`);
    return route(url, init);
  }) as typeof fetch;
  return { impl, calls };
}

/** Default deps: everything unreachable unless a test injects a double. */
export function makeDeps(overrides: Partial<McpServerDeps> = {}): McpServerDeps {
  return {
    fetchImpl: (async () => {
      throw new Error("test deps: fetchImpl not injected");
    }) as unknown as typeof fetch,
    facilitatorUrl: "http://127.0.0.1:4021",
    network: "stellar:testnet",
    maxAmount: 10_000_000n,
    payment: null,
    retryDelayMs: 0,
    ...overrides,
  };
}

/** The wire shape both tools answer with. */
export interface WireToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Opens a real MCP client session against the server under test, over a
 * linked in-memory transport pair — actual JSON-RPC, no shortcuts.
 */
export async function session(
  deps: McpServerDeps,
): Promise<{
  client: Client;
  call: (name: string, args: Record<string, unknown>) => Promise<WireToolResult>;
  close: () => Promise<void>;
}> {
  const server = buildMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    call: async (name, args) =>
      (await client.callTool({ name, arguments: args })) as unknown as WireToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
