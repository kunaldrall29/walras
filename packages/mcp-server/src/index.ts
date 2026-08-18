/**
 * Entry point: wires the real payment stack and serves MCP over stdio.
 *
 * Stdio discipline: stdout belongs to JSON-RPC; every human-facing line goes
 * to stderr. The wallet seams built here are the STOCK client path proven in
 * S2/S5 — `@x402/fetch` + `@x402/stellar` for HTTP resources, `@x402/mcp`
 * for MCP tools — over ONE shared x402Client carrying the spend-cap policy
 * (FACTS F-081), so no payment can bypass the cap.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { x402MCPClient } from "@x402/mcp";

import { ConfigError, loadConfig } from "./config.js";
import type { McpServerConfig } from "./config.js";
import { buildMcpServer } from "./server.js";
import type { McpServerDeps } from "./server.js";
import type { PaymentDeps } from "./paidCall.js";

export { buildMcpServer } from "./server.js";
export type { McpServerDeps } from "./server.js";
export { loadConfig, ConfigError } from "./config.js";
export type { McpServerConfig } from "./config.js";
export { mintResourceId, parseResourceId } from "./id.js";
export { WALRAS_MCP_REASON_CODES, WALRAS_MCP_REASON_TEXT } from "./errors.js";

/**
 * Loads `.env` from a path when present. Real environment variables win —
 * `process.loadEnvFile` does not overwrite what is already set.
 *
 * @param path - Path to the env file.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
}

/**
 * Builds the real payment seams over one shared, policy-capped x402Client.
 *
 * @param config - The parsed configuration (walletSecret non-null).
 * @returns The payment dependencies for paid_call.
 */
export function buildPaymentDeps(config: McpServerConfig & { walletSecret: string }): PaymentDeps {
  const signer = createEd25519Signer(config.walletSecret);
  const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
  // Belt-and-braces spend cap (F-081): paid_call declines over-cap 402s
  // before signing anything; this policy makes the same bound unbypassable
  // for every payment the shared client could ever make.
  client.registerPolicy((_version, requirements) =>
    requirements.filter(requirement => {
      if (requirement.network !== config.network || requirement.scheme !== "exact") return false;
      try {
        return BigInt(requirement.amount) <= config.maxAmount;
      } catch {
        return false;
      }
    }),
  );

  return {
    payingFetch: wrapFetchWithPayment(fetch, client) as typeof fetch,
    connectMcpClient: async (url, onPaymentRequested) => {
      const inner = new Client({ name: "walras-mcp-server", version: "0.1.0" });
      const paying = new x402MCPClient(inner, client, {
        autoPayment: true,
        onPaymentRequested,
      });
      await paying.connect(new StreamableHTTPClientTransport(url));
      return {
        callTool: (name, args) => paying.callTool(name, args),
        close: () => paying.close(),
      };
    },
  };
}

/**
 * Boots the MCP server on stdio.
 *
 * @returns Resolves once the transport is connected.
 */
async function main(): Promise<void> {
  loadEnvFile(resolve(process.cwd(), ".env"));
  loadEnvFile(resolve(process.cwd(), "../../.env"));

  let config: McpServerConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`walras mcp-server: invalid configuration — ${error.message}`);
      process.exit(78); // EX_CONFIG
    }
    throw error;
  }

  const deps: McpServerDeps = {
    fetchImpl: fetch,
    facilitatorUrl: config.facilitatorUrl,
    network: config.network,
    maxAmount: config.maxAmount,
    payment:
      config.walletSecret === null
        ? null
        : buildPaymentDeps({ ...config, walletSecret: config.walletSecret }),
    retryDelayMs: 2000,
  };

  const server = buildMcpServer(deps);
  await server.connect(new StdioServerTransport());

  console.error(
    `walras mcp-server ready on stdio — facilitator ${config.facilitatorUrl}, ` +
      `network ${config.network}, cap ${config.maxAmount} base units, ` +
      `wallet ${config.walletSecret === null ? "NOT configured (search-only)" : "configured"}`,
  );
}

// Only boot when executed directly, so importing the package in tests binds no transport.
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
