/**
 * The MCP server surface: two tools, search_resources and paid_call.
 *
 * Both tools answer with `structuredContent` AND `content[0].text` (the
 * JSON-stringified same object) — the dual-format rule the MCP transport
 * spec imposes on 402 results (FACTS F-079), applied uniformly so every
 * client, structured-content-aware or not, reads the same bytes. Domain
 * failures are `isError: true` results shaped `{errorCode, reason}`
 * (DECISIONS D-028); tools never throw them as protocol errors.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { StructuredError } from "./errors.js";
import { mcpError } from "./errors.js";
import { searchCatalog, toSearchEntry } from "./catalog.js";
import type { SearchEntry } from "./catalog.js";
import { paidCall } from "./paidCall.js";
import type { PaidCallDeps } from "./paidCall.js";

/** Dependencies of the server surface; a superset of the paid_call deps. */
export type McpServerDeps = PaidCallDeps;

/** The success payload of search_resources. Key order is the wire order. */
interface SearchResourcesOutcome {
  query: string;
  count: number;
  resources: SearchEntry[];
  partialResults: boolean;
  cursor: string | null;
}

/** Tool result in the shape the MCP SDK expects. */
interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Wraps a success payload as a dual-format tool result.
 *
 * @param value - The structured payload.
 * @returns The MCP tool result.
 */
function okResult(value: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

/**
 * Wraps a structured error as a dual-format `isError` tool result.
 *
 * @param error - The machine-readable rejection.
 * @returns The MCP tool result.
 */
function errResult(error: StructuredError): ToolResult {
  const value = { errorCode: error.errorCode, reason: error.reason };
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    isError: true,
  };
}

/**
 * Builds the walras MCP server over the given dependencies.
 *
 * @param deps - Injected dependencies (real wiring in index.ts).
 * @returns The configured McpServer, not yet connected to a transport.
 */
export function buildMcpServer(deps: McpServerDeps): McpServer {
  const server = new McpServer(
    { name: "walras-mcp-server", version: "0.1.0" },
    {
      instructions:
        "Discover and pay x402 resources on Stellar. Use search_resources to find " +
        "payable HTTP endpoints and MCP tools in the walras Bazaar catalog (every " +
        "listing was cataloged from a real settled payment), then paid_call to call " +
        "one — payment is negotiated, settled on-chain through the walras " +
        "facilitator, and receipted with the transaction hash automatically. " +
        "Errors are always machine-readable: {errorCode, reason}.",
    },
  );

  server.registerTool(
    "search_resources",
    {
      title: "Search the walras Bazaar",
      description:
        "Full-text search over the walras Bazaar catalog of x402-payable resources " +
        "(HTTP endpoints and MCP tools) on Stellar. Returns deterministic JSON: for " +
        "each hit an id (pass it to paid_call), name, description, price " +
        "({scheme, network, asset, amount, payTo} — amount in USDC base units, 7 " +
        "decimals), network, the input calling convention (method, example values, " +
        "JSON schema), and lastUpdated. partialResults=true means matches were " +
        "truncated; pass cursor to continue. Errors: {errorCode, reason}.",
      inputSchema: {
        query: z.string().min(1).describe("Free-text search query (required)."),
        filters: z
          .object({
            type: z.enum(["http", "mcp"]).optional().describe("Listing type."),
            network: z
              .string()
              .optional()
              .describe("CAIP-2 network filter, e.g. stellar:testnet."),
            scheme: z.string().optional().describe("Payment scheme filter, e.g. exact."),
            payTo: z.string().optional().describe("Filter to one seller address."),
            limit: z
              .number()
              .int()
              .min(1)
              .max(100)
              .optional()
              .describe("Advisory maximum number of results."),
            cursor: z
              .string()
              .optional()
              .describe("Continuation cursor from a previous result."),
          })
          .optional()
          .describe("Optional filters, forwarded to the catalog."),
      },
    },
    async ({ query, filters }) => {
      try {
        const searched = await searchCatalog(deps.fetchImpl, deps.facilitatorUrl, query, {
          type: filters?.type,
          network: filters?.network,
          scheme: filters?.scheme,
          payTo: filters?.payTo,
          limit: filters?.limit,
          cursor: filters?.cursor,
        });
        if (searched.err) return errResult(searched.err);
        const outcome: SearchResourcesOutcome = {
          query,
          count: searched.ok.resources.length,
          resources: searched.ok.resources.map(toSearchEntry),
          partialResults: searched.ok.partialResults,
          cursor: searched.ok.pagination?.cursor ?? null,
        };
        return okResult(outcome as unknown as Record<string, unknown>);
      } catch (error) {
        return errResult(
          mcpError("walras_mcp_internal_error", `Unhandled: ${(error as Error).message}`),
        );
      }
    },
  );

  server.registerTool(
    "paid_call",
    {
      title: "Call a paid x402 resource",
      description:
        "Call an x402-payable resource, paying automatically with this server's " +
        "Stellar wallet through the walras facilitator. Address the target by " +
        "resourceId (from search_resources) or by url — plus toolName when the " +
        "target is an MCP tool. input carries the resource's parameters; when " +
        "omitted, the listing's declared example values are used. Free resources " +
        "return paid=false without payment. On success returns the resource result " +
        "plus a receipt {transaction, network, payer} — transaction is the on-chain " +
        "hash. Per-call spend is capped (WALRAS_MCP_MAX_AMOUNT, USDC base units); a " +
        "402 over the cap is refused without paying. Errors: {errorCode, reason}.",
      inputSchema: {
        resourceId: z
          .string()
          .optional()
          .describe("A resource id minted by search_resources."),
        url: z
          .string()
          .url()
          .optional()
          .describe("Explicit resource URL (instead of resourceId)."),
        toolName: z
          .string()
          .optional()
          .describe("MCP tool name; only with url, marks the target as an MCP server."),
        method: z
          .enum(["GET", "POST"])
          .optional()
          .describe("HTTP method for url-form http targets. Default GET."),
        input: z
          .record(z.unknown())
          .optional()
          .describe("Input values for the resource (query params, JSON body, or tool args)."),
      },
    },
    async args => {
      const result = await paidCall(deps, args);
      if (result.err) return errResult(result.err);
      return okResult(result.ok as unknown as Record<string, unknown>);
    },
  );

  return server;
}
