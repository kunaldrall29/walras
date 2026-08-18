/**
 * paid_call, mcp leg — the REAL `@x402/mcp` x402MCPClient talking real
 * JSON-RPC over a linked in-memory transport pair to a paid MCP server
 * double that speaks the transport spec exactly (FACTS F-079): 402 as an
 * isError result with PaymentRequired in structuredContent AND
 * content[0].text, payment in `_meta["x402/payment"]`, receipt in
 * `_meta["x402/payment-response"]`.
 *
 * Only the payment SCHEME is a double (a fake SchemeNetworkClient that
 * builds a placeholder payload instead of a signed Stellar transaction) —
 * chain-touching payloads are the live demo's job (EVIDENCE S6). Everything
 * from paid_call down through @x402/mcp and the MCP SDK is the real stack.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { x402Client } from "@x402/core/client";
import { MCP_PAYMENT_META_KEY, MCP_PAYMENT_RESPONSE_META_KEY, x402MCPClient } from "@x402/mcp";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";

import { paidCall } from "../src/paidCall.js";
import type { PaymentDeps } from "../src/paidCall.js";
import { SELLER, USDC, makeDeps } from "./helpers.js";

const MCP_URL = "http://127.0.0.1:4023/mcp";

function paymentRequired(amount: string): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required to access this tool",
    resource: { url: `${MCP_URL}#hello`, description: "hello tool", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: "stellar:testnet",
        asset: USDC,
        amount,
        payTo: SELLER,
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
  };
}

const SETTLED: SettleResponse = {
  success: true,
  transaction: "cd".repeat(32),
  network: "stellar:testnet",
  payer: "GBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYE",
};

/** A fake scheme client: shaped like the wire, signs nothing. */
const fakeScheme = {
  scheme: "exact",
  createPaymentPayload: async (x402Version: number) => ({
    x402Version,
    payload: { transaction: "UNSIGNED-TEST-PAYLOAD" },
  }),
};

interface PaidServerOptions {
  amount: string;
  /** When true, a paid attempt still fails settlement (spec R5 shape). */
  settleFails?: boolean;
  /** When true, the tool is free — no 402 at all. */
  free?: boolean;
}

/**
 * Builds a transport-spec-compliant paid MCP server double and returns a
 * connectMcpClient seam wired to it through a REAL x402MCPClient.
 */
async function paidServerSeam(options: PaidServerOptions): Promise<{
  payment: PaymentDeps;
  executions: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}> {
  const executions: Array<Record<string, unknown>> = [];
  const server = new McpServer({ name: "paid-double", version: "0.0.0" });

  server.registerTool(
    "hello",
    { description: "Greets a person (paid)", inputSchema: { name: z.string() } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (async (args: { name: string }, extra: any) => {
      const payment = extra?._meta?.[MCP_PAYMENT_META_KEY];
      if (!options.free && payment === undefined) {
        const required = paymentRequired(options.amount);
        return {
          isError: true,
          structuredContent: required as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: JSON.stringify(required) }],
        };
      }
      if (!options.free && options.settleFails === true) {
        // Settlement failure: same 402 shape, tool content withheld (F-079).
        const required = paymentRequired(options.amount);
        const failed = { ...required, error: "Settlement failed" };
        return {
          isError: true,
          structuredContent: failed as unknown as Record<string, unknown>,
          content: [{ type: "text" as const, text: JSON.stringify(failed) }],
        };
      }
      executions.push(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ greeting: `hi ${args.name}` }) }],
        ...(options.free
          ? {}
          : { _meta: { [MCP_PAYMENT_RESPONSE_META_KEY]: SETTLED } }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const payment: PaymentDeps = {
    payingFetch: (() => Promise.reject(new Error("not used"))) as unknown as typeof fetch,
    connectMcpClient: async (_url, onPaymentRequested) => {
      const inner = new Client({ name: "walras-mcp-server", version: "0.1.0" });
      const paymentClient = new x402Client().register("stellar:*", fakeScheme);
      const paying = new x402MCPClient(inner, paymentClient, {
        autoPayment: true,
        onPaymentRequested,
      });
      await paying.connect(clientTransport);
      return {
        callTool: (name, args) => paying.callTool(name, args),
        close: () => paying.close(),
      };
    },
  };

  return { payment, executions, close: () => server.close() };
}

describe("paid_call: mcp leg (real @x402/mcp client over real JSON-RPC)", () => {
  it("pays a 402 tool and returns result + receipt", async () => {
    const seam = await paidServerSeam({ amount: "200000" });
    try {
      const result = await paidCall(makeDeps({ payment: seam.payment }), {
        url: MCP_URL,
        toolName: "hello",
        input: { name: "Ada" },
      });
      expect(result.err).toBeUndefined();
      expect(result.ok).toEqual({
        paid: true,
        receipt: {
          transaction: SETTLED.transaction,
          network: "stellar:testnet",
          payer: SETTLED.payer,
        },
        resource: MCP_URL,
        type: "mcp",
        toolName: "hello",
        status: null,
        result: { greeting: "hi Ada" },
      });
      expect(seam.executions).toEqual([{ name: "Ada" }]);
    } finally {
      await seam.close();
    }
  });

  it("declines an over-cap tool price in the payment hook; the tool never executes", async () => {
    const seam = await paidServerSeam({ amount: "20000000" }); // 2 USDC > 1 USDC cap
    try {
      const result = await paidCall(makeDeps({ payment: seam.payment }), {
        url: MCP_URL,
        toolName: "hello",
        input: { name: "Ada" },
      });
      expect(result.err?.errorCode).toBe("walras_mcp_payment_declined_by_policy");
      expect(result.err?.reason).toContain("20000000");
      expect(seam.executions).toEqual([]);
    } finally {
      await seam.close();
    }
  });

  it("returns a free tool without payment (paid=false)", async () => {
    const seam = await paidServerSeam({ amount: "0", free: true });
    try {
      const result = await paidCall(makeDeps({ payment: seam.payment }), {
        url: MCP_URL,
        toolName: "hello",
        input: { name: "Ada" },
      });
      expect(result.ok?.paid).toBe(false);
      expect(result.ok?.receipt).toBeNull();
      expect(result.ok?.result).toEqual({ greeting: "hi Ada" });
    } finally {
      await seam.close();
    }
  });

  it("maps a post-payment 402-shaped result to payment_not_settled (spec R5)", async () => {
    const seam = await paidServerSeam({ amount: "200000", settleFails: true });
    try {
      const result = await paidCall(makeDeps({ payment: seam.payment }), {
        url: MCP_URL,
        toolName: "hello",
        input: { name: "Ada" },
      });
      expect(result.err?.errorCode).toBe("walras_mcp_payment_not_settled");
      expect(result.err?.reason).toBeTruthy();
      expect(seam.executions).toEqual([]); // tool content withheld, nothing executed
    } finally {
      await seam.close();
    }
  });

  it("requires a wallet for mcp targets", async () => {
    const result = await paidCall(makeDeps({ payment: null }), {
      url: MCP_URL,
      toolName: "hello",
    });
    expect(result.err?.errorCode).toBe("walras_mcp_wallet_not_configured");
  });

  it("maps a connect failure to resource_unreachable", async () => {
    const payment: PaymentDeps = {
      payingFetch: (() => Promise.reject(new Error("not used"))) as unknown as typeof fetch,
      connectMcpClient: () => Promise.reject(new Error("ECONNREFUSED 127.0.0.1:4023")),
    };
    const result = await paidCall(makeDeps({ payment }), {
      url: MCP_URL,
      toolName: "hello",
    });
    expect(result.err?.errorCode).toBe("walras_mcp_resource_unreachable");
  });
});
