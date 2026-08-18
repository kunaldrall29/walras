/**
 * paid_call, http leg — against fetch doubles that speak the v2 wire
 * (PAYMENT-REQUIRED / PAYMENT-RESPONSE headers, FACTS F-065) using the STOCK
 * `@x402/core` header encoders, so the doubles cannot drift from the codec
 * the real facilitator path uses. The paying seam is a double; the REAL
 * on-chain path is exercised by the live demo (EVIDENCE S6).
 */
import { describe, expect, it } from "vitest";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";

import { paidCall } from "../src/paidCall.js";
import { mintResourceId } from "../src/id.js";
import { SELLER, USDC, fetchDouble, httpListing, listBody, makeDeps } from "./helpers.js";

const WEATHER = "http://127.0.0.1:4022/weather";

function paymentRequired(
  amount: string,
  network: `${string}:${string}` = "stellar:testnet",
): PaymentRequired {
  return {
    x402Version: 2,
    error: "Payment required",
    resource: { url: WEATHER, description: "weather", mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network,
        asset: USDC,
        amount,
        payTo: SELLER,
        maxTimeoutSeconds: 300,
        extra: {},
      },
    ],
  };
}

function a402(amount: string, network?: `${string}:${string}`): Response {
  return new Response(JSON.stringify({ error: "Payment required" }), {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired(amount, network)) },
  });
}

const SETTLED: SettleResponse = {
  success: true,
  transaction: "ac".repeat(32),
  network: "stellar:testnet",
  payer: "GBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYERBUYE",
};

function paidOk(body: unknown, receipt: SettleResponse = SETTLED): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(receipt) },
  });
}

describe("paid_call: argument validation", () => {
  it.each([
    [{}, "neither resourceId nor url"],
    [{ resourceId: "wr1:x", url: "http://a/b" }, "both resourceId and url"],
  ])("rejects %j (%s)", async (args: Record<string, unknown>, _label: string) => {
    const result = await paidCall(makeDeps(), args as Record<string, never>);
    expect(result.err?.errorCode).toBe("walras_mcp_invalid_arguments");
    expect(result.err?.reason).toBeTruthy();
  });

  it("rejects toolName alongside resourceId", async () => {
    const result = await paidCall(makeDeps(), { resourceId: "wr1:x", toolName: "hello" });
    expect(result.err?.errorCode).toBe("walras_mcp_invalid_arguments");
  });

  it("rejects an undecodable resourceId", async () => {
    const result = await paidCall(makeDeps(), { resourceId: "not-an-id" });
    expect(result.err?.errorCode).toBe("walras_mcp_unknown_resource_id");
  });

  it("rejects a well-formed id the catalog does not have", async () => {
    const { impl } = fetchDouble({
      "/discovery/resources": () => new Response(listBody([], 0), { status: 200 }),
    });
    const id = mintResourceId({ type: "http", resource: "http://gone/x", toolName: "" });
    const result = await paidCall(makeDeps({ fetchImpl: impl }), { resourceId: id });
    expect(result.err?.errorCode).toBe("walras_mcp_unknown_resource_id");
  });
});

describe("paid_call: http leg", () => {
  it("pays a 402 resource by resourceId, building the request from the catalog convention", async () => {
    const listing = httpListing();
    const { impl, calls } = fetchDouble({
      "/discovery/resources": () => new Response(listBody([listing]), { status: 200 }),
      "/weather": () => a402("100000"),
    });
    const paying = fetchDouble({
      "/weather": () => paidOk({ tempC: 21 }),
    });
    const deps = makeDeps({
      fetchImpl: impl,
      payment: {
        payingFetch: paying.impl,
        connectMcpClient: () => Promise.reject(new Error("not used")),
      },
    });
    const id = mintResourceId({ type: "http", resource: WEATHER, toolName: "" });
    const result = await paidCall(deps, { resourceId: id, input: { city: "Bern" } });

    expect(result.err).toBeUndefined();
    expect(result.ok).toEqual({
      paid: true,
      receipt: {
        transaction: SETTLED.transaction,
        network: "stellar:testnet",
        payer: SETTLED.payer,
      },
      resource: WEATHER,
      type: "http",
      toolName: null,
      status: 200,
      result: { tempC: 21 },
    });

    // The caller's input became query parameters on both probe and paid call.
    const probeUrl = calls.find(call => call.url.pathname === "/weather")?.url;
    expect(probeUrl?.searchParams.get("city")).toBe("Bern");
    expect(paying.calls[0].url.searchParams.get("city")).toBe("Bern");
  });

  it("falls back to the listing's example values when input is omitted", async () => {
    const listing = httpListing();
    const { impl, calls } = fetchDouble({
      "/discovery/resources": () => new Response(listBody([listing]), { status: 200 }),
      "/weather": () => new Response(JSON.stringify({ tempC: 21 }), { status: 200 }),
    });
    const id = mintResourceId({ type: "http", resource: WEATHER, toolName: "" });
    const result = await paidCall(makeDeps({ fetchImpl: impl }), { resourceId: id });
    expect(result.ok?.paid).toBe(false);
    const probeUrl = calls.find(call => call.url.pathname === "/weather")?.url;
    expect(probeUrl?.searchParams.get("city")).toBe("Zurich");
    expect(probeUrl?.searchParams.get("units")).toBe("metric");
  });

  it("returns a free resource without paying (paid=false, no receipt)", async () => {
    const { impl } = fetchDouble({
      "/free": () => new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
    });
    const result = await paidCall(makeDeps({ fetchImpl: impl }), {
      url: "http://127.0.0.1:4022/free",
    });
    expect(result.ok?.paid).toBe(false);
    expect(result.ok?.receipt).toBeNull();
    expect(result.ok?.result).toEqual({ hello: "world" });
  });

  it("declines an over-cap 402 without ever invoking the paying fetch", async () => {
    const { impl } = fetchDouble({ "/weather": () => a402("20000000") }); // 2 USDC > 1 USDC cap
    const paying = fetchDouble({});
    const deps = makeDeps({
      fetchImpl: impl,
      payment: {
        payingFetch: paying.impl,
        connectMcpClient: () => Promise.reject(new Error("not used")),
      },
    });
    const result = await paidCall(deps, { url: WEATHER });
    expect(result.err?.errorCode).toBe("walras_mcp_payment_declined_by_policy");
    expect(result.err?.reason).toContain("20000000");
    expect(paying.calls.length).toBe(0);
  });

  it("declines a 402 payable only on a foreign network", async () => {
    const { impl } = fetchDouble({ "/weather": () => a402("100000", "eip155:84532") });
    const result = await paidCall(
      makeDeps({
        fetchImpl: impl,
        payment: {
          payingFetch: (() => Promise.reject(new Error("not used"))) as unknown as typeof fetch,
          connectMcpClient: () => Promise.reject(new Error("not used")),
        },
      }),
      { url: WEATHER },
    );
    expect(result.err?.errorCode).toBe("walras_mcp_payment_declined_by_policy");
    expect(result.err?.reason).toContain("exact@eip155:84532");
  });

  it("names a missing wallet only after a payable 402 (search-only mode)", async () => {
    const { impl } = fetchDouble({ "/weather": () => a402("100000") });
    const result = await paidCall(makeDeps({ fetchImpl: impl, payment: null }), { url: WEATHER });
    expect(result.err?.errorCode).toBe("walras_mcp_wallet_not_configured");
  });

  it("maps a non-402 upstream failure to resource_error without paying", async () => {
    const { impl } = fetchDouble({
      "/weather": () => new Response("boom", { status: 500 }),
    });
    const result = await paidCall(makeDeps({ fetchImpl: impl }), { url: WEATHER });
    expect(result.err?.errorCode).toBe("walras_mcp_resource_error");
    expect(result.err?.reason).toContain("500");
  });

  it("maps a transport failure to resource_unreachable", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await paidCall(makeDeps({ fetchImpl: impl }), { url: WEATHER });
    expect(result.err?.errorCode).toBe("walras_mcp_resource_unreachable");
  });

  it("retries once, then passes the facilitator's settle code through verbatim", async () => {
    const { impl } = fetchDouble({ "/weather": () => a402("100000") });
    const failed: SettleResponse = {
      success: false,
      errorReason: "verification_failed",
      errorMessage: "Settle re-ran verification and it did not pass.",
      transaction: "",
      network: "stellar:testnet",
    };
    const paying = fetchDouble({
      "/weather": () =>
        new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402,
          headers: {
            "PAYMENT-REQUIRED": encodePaymentRequiredHeader(paymentRequired("100000")),
            "PAYMENT-RESPONSE": encodePaymentResponseHeader(failed),
          },
        }),
    });
    const deps = makeDeps({
      fetchImpl: impl,
      payment: {
        payingFetch: paying.impl,
        connectMcpClient: () => Promise.reject(new Error("not used")),
      },
    });
    const result = await paidCall(deps, { url: WEATHER });
    expect(paying.calls.length).toBe(2); // one visible retry, then a real failure
    expect(result.err?.errorCode).toBe("verification_failed");
    expect(result.err?.reason).toBe("Settle re-ran verification and it did not pass.");
  });

  it("names an unsettled payment when no receipt code is available", async () => {
    const { impl } = fetchDouble({ "/weather": () => a402("100000") });
    const paying = fetchDouble({
      "/weather": () => new Response("try later", { status: 402 }),
    });
    const deps = makeDeps({
      fetchImpl: impl,
      payment: {
        payingFetch: paying.impl,
        connectMcpClient: () => Promise.reject(new Error("not used")),
      },
    });
    const result = await paidCall(deps, { url: WEATHER });
    expect(result.err?.errorCode).toBe("walras_mcp_payment_not_settled");
    expect(result.err?.reason).toContain("2 attempts");
  });

  it("maps a client-side policy exhaustion throw to declined_by_policy (F-081)", async () => {
    const { impl } = fetchDouble({ "/weather": () => a402("100000") });
    const paying = (async () => {
      throw new Error("All payment requirements were filtered out by policies for x402 version: 2");
    }) as unknown as typeof fetch;
    const deps = makeDeps({
      fetchImpl: impl,
      payment: {
        payingFetch: paying,
        connectMcpClient: () => Promise.reject(new Error("not used")),
      },
    });
    const result = await paidCall(deps, { url: WEATHER });
    expect(result.err?.errorCode).toBe("walras_mcp_payment_declined_by_policy");
  });
});
