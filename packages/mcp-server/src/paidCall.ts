/**
 * paid_call — the discover→pay bridge.
 *
 * Resolves a target (a resourceId minted by search_resources, or an explicit
 * url [+ toolName for MCP tools]), then runs the x402 flow appropriate to the
 * listing type:
 *
 *  - http: probe → decode the v2 402 (`PAYMENT-REQUIRED`, FACTS F-065) →
 *    spend-cap check → pay via the STOCK client path (`@x402/fetch` +
 *    `@x402/stellar`), one visible retry for testnet congestion (the S5
 *    lesson) → receipt from `PAYMENT-RESPONSE`.
 *  - mcp: connect a stock `x402MCPClient` (`@x402/mcp`) over streamable HTTP
 *    and let it run the transport-spec flow (FACTS F-079/F-080); the spend
 *    cap is enforced in its onPaymentRequested hook.
 *
 * Both paths pay through the SAME shared x402Client, so the registered cap
 * policy (FACTS F-081) binds every payment this server can make, and every
 * failure exits as a StructuredError (DECISIONS D-028) — never a throw.
 */

import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";

import type { StructuredError } from "./errors.js";
import { facilitatorError, isFacilitatorCode, mcpError } from "./errors.js";
import { parseResourceId } from "./id.js";
import type { ResourceIdentity } from "./id.js";
import { callingConvention, findListing } from "./catalog.js";
import type { CallingConvention } from "./catalog.js";

/** Result of a tool call as the x402 MCP client wrapper returns it. */
export interface McpToolCallOutcome {
  content: Array<{ [key: string]: unknown; type: string }>;
  isError?: boolean;
  paymentResponse?: SettleResponse;
  paymentMade: boolean;
}

/** A connected, payment-capable MCP client for one paid_call invocation. */
export interface McpPayClientHandle {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallOutcome>;
  close(): Promise<void>;
}

/** The payment seams. Real wiring in index.ts; tests inject doubles. */
export interface PaymentDeps {
  /** Product of stock `wrapFetchWithPayment` over the shared x402Client. */
  payingFetch: typeof fetch;
  /**
   * Connects a payment-capable MCP client to a streamable-HTTP MCP server.
   * The hook decides per-402 whether to pay (the spend-cap check).
   */
  connectMcpClient(
    url: URL,
    onPaymentRequested: (context: { paymentRequired: PaymentRequired }) => boolean,
  ): Promise<McpPayClientHandle>;
}

/** Dependencies for paid_call. */
export interface PaidCallDeps {
  fetchImpl: typeof fetch;
  facilitatorUrl: string;
  /** The one network this server's wallet pays on, e.g. "stellar:testnet". */
  network: string;
  /** Per-call spend cap in asset base units (USDC: 7 decimals, F-008). */
  maxAmount: bigint;
  /** Null when CLIENT_STELLAR_PRIVATE_KEY is not configured. */
  payment: PaymentDeps | null;
  /** Delay before the single payment retry; tests set 0. */
  retryDelayMs: number;
}

/** Arguments of the paid_call tool after schema validation. */
export interface PaidCallArgs {
  resourceId?: string;
  url?: string;
  toolName?: string;
  method?: "GET" | "POST";
  input?: Record<string, unknown>;
}

/** The success payload of paid_call. Key order is the wire order. */
export interface PaidCallOutcome {
  paid: boolean;
  receipt: { transaction: string; network: string; payer: string | null } | null;
  resource: string;
  type: "http" | "mcp";
  toolName: string | null;
  status: number | null;
  result: unknown;
}

/** Discriminated result: outcome or structured error. */
export type PaidCallResult =
  | { ok: PaidCallOutcome; err?: never }
  | { ok?: never; err: StructuredError };

/**
 * Picks the payment requirement this wallet could satisfy and enforces the
 * spend cap. Mirrors the policy registered on the shared x402Client (F-081)
 * so a decline happens BEFORE any payload is built or signed.
 *
 * @param accepts - The 402's payment options.
 * @param network - The one network this wallet pays on.
 * @param maxAmount - The per-call cap in base units.
 * @returns The acceptable requirement, or a structured decline.
 */
function checkAccepts(
  accepts: Array<{ scheme: string; network: string; amount: string }>,
  network: string,
  maxAmount: bigint,
): { ok?: { amount: bigint }; err?: StructuredError } {
  const onNetwork = accepts.filter(a => a.scheme === "exact" && a.network === network);
  if (onNetwork.length === 0) {
    const offered = [...new Set(accepts.map(a => `${a.scheme}@${a.network}`))].sort().join(", ");
    return {
      err: mcpError(
        "walras_mcp_payment_declined_by_policy",
        `The resource accepts [${offered || "nothing"}], but this wallet pays only exact@${network}.`,
      ),
    };
  }
  let cheapest: bigint | null = null;
  for (const option of onNetwork) {
    try {
      const amount = BigInt(option.amount);
      if (cheapest === null || amount < cheapest) cheapest = amount;
    } catch {
      // non-numeric amount: not payable, skip
    }
  }
  if (cheapest === null) {
    return {
      err: mcpError(
        "walras_mcp_payment_declined_by_policy",
        "No offered amount on this network parses as an integer of base units.",
      ),
    };
  }
  if (cheapest > maxAmount) {
    return {
      err: mcpError(
        "walras_mcp_payment_declined_by_policy",
        `It asks ${cheapest} base units; the cap is ${maxAmount}.`,
      ),
    };
  }
  return { ok: { amount: cheapest } };
}

/**
 * Maps a settle receipt that did not succeed to a structured error,
 * passing facilitator/package codes through verbatim.
 *
 * @param receipt - The failed settle response, if one arrived.
 * @param detail - Fallback context when the receipt names no code.
 * @returns The structured error.
 */
function settleFailure(receipt: SettleResponse | null, detail: string): StructuredError {
  if (receipt?.errorReason !== undefined && isFacilitatorCode(receipt.errorReason)) {
    return facilitatorError(receipt.errorReason, receipt.errorMessage);
  }
  const upstream =
    receipt?.errorReason !== undefined ? ` Upstream errorReason: ${receipt.errorReason}.` : "";
  return mcpError("walras_mcp_payment_not_settled", `${detail}${upstream}`);
}

/**
 * Builds the HTTP request for an http-typed target from the listing's
 * calling convention and the caller's input. GET inputs become query
 * parameters (keys sorted, for a deterministic URL); body-typed inputs
 * become a JSON body. When the caller omits input, the listing's declared
 * example values are used.
 *
 * @param resource - The listing's resource URL.
 * @param convention - The listing's calling convention (F-082).
 * @param input - Caller-supplied input values.
 * @returns The target URL and request init.
 */
function buildHttpRequest(
  resource: string,
  convention: CallingConvention,
  input: Record<string, unknown> | undefined,
): { target: URL; init: RequestInit } {
  const method = (convention.method ?? "GET").toUpperCase();
  const values = input ?? convention.example ?? {};
  const target = new URL(resource);
  let init: RequestInit = { method };
  const bodyMethod =
    convention.bodyType !== null || (method !== "GET" && method !== "HEAD" && method !== "DELETE");
  if (bodyMethod) {
    init = {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    };
  } else {
    for (const key of Object.keys(values).sort()) {
      target.searchParams.set(key, String(values[key]));
    }
  }
  return { target, init };
}

/**
 * Parses a response body as JSON when possible, else returns the raw text.
 *
 * @param text - The body text.
 * @returns Parsed JSON value or the original string.
 */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Executes paid_call. Never throws for domain failures — every rejection is
 * a StructuredError with a machine code and non-null reason (D-028).
 *
 * @param deps - Injected dependencies.
 * @param args - Validated tool arguments.
 * @returns The outcome or a structured error.
 */
export async function paidCall(deps: PaidCallDeps, args: PaidCallArgs): Promise<PaidCallResult> {
  // --- resolve the target -------------------------------------------------
  const hasId = args.resourceId !== undefined;
  const hasUrl = args.url !== undefined;
  if (hasId === hasUrl) {
    return {
      err: mcpError("walras_mcp_invalid_arguments", "Provide exactly one of resourceId or url."),
    };
  }
  if (hasId && (args.toolName !== undefined || args.method !== undefined)) {
    return {
      err: mcpError(
        "walras_mcp_invalid_arguments",
        "toolName and method are derived from the catalog when resourceId is used.",
      ),
    };
  }

  let identity: ResourceIdentity;
  let convention: CallingConvention;
  if (hasId) {
    const parsed = parseResourceId(args.resourceId as string);
    if (parsed === null) {
      return { err: mcpError("walras_mcp_unknown_resource_id", "The id did not decode.") };
    }
    // The id must still resolve to a cataloged listing — ids never outlive
    // the catalog (D-029) — and the listing carries the calling convention.
    const found = await findListing(deps.fetchImpl, deps.facilitatorUrl, parsed);
    if (found.err) return { err: found.err };
    identity = parsed;
    convention = callingConvention(found.ok);
  } else {
    const toolName = args.toolName ?? "";
    identity = {
      type: toolName === "" ? "http" : "mcp",
      resource: args.url as string,
      toolName,
    };
    convention = {
      method: args.method ?? "GET",
      bodyType: args.method === "POST" ? "json" : null,
      example: null,
      schema: null,
    };
  }

  try {
    if (identity.type === "mcp") {
      return await payMcpTool(deps, identity, args.input ?? convention.example ?? {});
    }
    return await payHttpResource(deps, identity, convention, args.input);
  } catch (error) {
    return {
      err: mcpError("walras_mcp_internal_error", `Unhandled: ${(error as Error).message}`),
    };
  }
}

/**
 * The http-typed leg: probe, decode the 402, check the cap, pay via the
 * stock fetch wrapper with one visible retry, decode the receipt.
 *
 * @param deps - Injected dependencies.
 * @param identity - The resolved target.
 * @param convention - The calling convention to build the request from.
 * @param input - Caller-supplied input values.
 * @returns The outcome or a structured error.
 */
async function payHttpResource(
  deps: PaidCallDeps,
  identity: ResourceIdentity,
  convention: CallingConvention,
  input: Record<string, unknown> | undefined,
): Promise<PaidCallResult> {
  const { target, init } = buildHttpRequest(identity.resource, convention, input);

  // Probe without payment: a free resource returns here, a 402 tells us the
  // price BEFORE anything is signed. (Same probe-has-side-effects caveat as
  // the SDK's getToolPaymentRequirements, F-080.)
  let probe: Response;
  try {
    probe = await deps.fetchImpl(target, init);
  } catch (error) {
    return {
      err: mcpError("walras_mcp_resource_unreachable", `${target}: ${(error as Error).message}`),
    };
  }
  const probeText = await probe.text();

  if (probe.status === 200) {
    return {
      ok: {
        paid: false,
        receipt: null,
        resource: identity.resource,
        type: "http",
        toolName: null,
        status: 200,
        result: parseBody(probeText),
      },
    };
  }
  if (probe.status !== 402) {
    return {
      err: mcpError(
        "walras_mcp_resource_error",
        `HTTP ${probe.status}: ${probeText.slice(0, 300)}`,
      ),
    };
  }

  const requiredHeader = probe.headers.get("PAYMENT-REQUIRED");
  let paymentRequired: PaymentRequired;
  try {
    if (requiredHeader === null) throw new Error("no PAYMENT-REQUIRED header");
    paymentRequired = decodePaymentRequiredHeader(requiredHeader);
  } catch (error) {
    return {
      err: mcpError(
        "walras_mcp_resource_error",
        `402 without a decodable v2 PAYMENT-REQUIRED header (${(error as Error).message}).`,
      ),
    };
  }

  const acceptable = checkAccepts(paymentRequired.accepts, deps.network, deps.maxAmount);
  if (acceptable.err) return { err: acceptable.err };

  if (deps.payment === null) {
    return { err: mcpError("walras_mcp_wallet_not_configured") };
  }

  // Pay via the stock wrapper. One visible retry: a settle that outlives the
  // middleware timeout re-402s honestly under testnet congestion (S5-5).
  let lastReceipt: SettleResponse | null = null;
  let lastDetail = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (attempt === 2 && deps.retryDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, deps.retryDelayMs));
    }
    let response: Response;
    try {
      response = await deps.payment.payingFetch(target, init);
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes("filtered out by policies")) {
        return {
          err: mcpError(
            "walras_mcp_payment_declined_by_policy",
            "The client-side policy rejected every fresh payment option.",
          ),
        };
      }
      lastDetail = `Payment attempt threw: ${message}.`;
      continue;
    }
    const bodyText = await response.text();
    const receiptHeader = response.headers.get("PAYMENT-RESPONSE");
    let receipt: SettleResponse | null = null;
    if (receiptHeader !== null) {
      try {
        receipt = decodePaymentResponseHeader(receiptHeader);
      } catch {
        receipt = null;
      }
    }
    if (response.status === 200 && receipt?.success === true) {
      return {
        ok: {
          paid: true,
          receipt: {
            transaction: receipt.transaction,
            network: receipt.network,
            payer: receipt.payer ?? null,
          },
          resource: identity.resource,
          type: "http",
          toolName: null,
          status: 200,
          result: parseBody(bodyText),
        },
      };
    }
    lastReceipt = receipt;
    lastDetail = `HTTP ${response.status} after paying.`;
  }
  return {
    err: settleFailure(lastReceipt, `${lastDetail} No successful receipt after 2 attempts.`),
  };
}

/**
 * The mcp-typed leg: connect a stock payment-capable MCP client and call the
 * tool; the transport-spec flow (F-079) runs inside `@x402/mcp`.
 *
 * @param deps - Injected dependencies.
 * @param identity - The resolved target (resource URL + toolName).
 * @param input - Tool arguments to send.
 * @returns The outcome or a structured error.
 */
async function payMcpTool(
  deps: PaidCallDeps,
  identity: ResourceIdentity,
  input: Record<string, unknown>,
): Promise<PaidCallResult> {
  if (deps.payment === null) {
    return { err: mcpError("walras_mcp_wallet_not_configured") };
  }

  let declined: StructuredError | null = null;
  const onPaymentRequested = (context: { paymentRequired: PaymentRequired }): boolean => {
    const verdict = checkAccepts(context.paymentRequired.accepts, deps.network, deps.maxAmount);
    if (verdict.err) {
      declined = verdict.err;
      return false;
    }
    return true;
  };

  let handle: McpPayClientHandle;
  try {
    handle = await deps.payment.connectMcpClient(new URL(identity.resource), onPaymentRequested);
  } catch (error) {
    return {
      err: mcpError(
        "walras_mcp_resource_unreachable",
        `MCP connect to ${identity.resource}: ${(error as Error).message}`,
      ),
    };
  }

  try {
    const outcome = await handle.callTool(identity.toolName, input);

    if (outcome.isError === true) {
      const text =
        outcome.content[0]?.type === "text" && typeof outcome.content[0]["text"] === "string"
          ? (outcome.content[0]["text"] as string)
          : "";
      const parsed = parseBody(text);
      const isPaymentShaped =
        typeof parsed === "object" &&
        parsed !== null &&
        "x402Version" in parsed &&
        "accepts" in parsed;
      if (isPaymentShaped) {
        // Per the transport spec, a 402-shaped error AFTER payment is a
        // settlement failure and the tool's content is withheld (F-079).
        const serverError = (parsed as { error?: string }).error;
        return {
          err: settleFailure(
            outcome.paymentResponse ?? null,
            serverError !== undefined
              ? `Server reported: ${serverError}.`
              : "Server returned a 402-shaped error.",
          ),
        };
      }
      return {
        err: mcpError("walras_mcp_tool_call_failed", `Tool errored: ${text.slice(0, 300)}`),
      };
    }

    if (outcome.paymentMade && outcome.paymentResponse?.success !== true) {
      return {
        err: settleFailure(
          outcome.paymentResponse ?? null,
          "Payment was sent but the result carried no successful receipt.",
        ),
      };
    }

    const text =
      outcome.content[0]?.type === "text" && typeof outcome.content[0]["text"] === "string"
        ? (outcome.content[0]["text"] as string)
        : "";
    const receipt = outcome.paymentMade && outcome.paymentResponse ? outcome.paymentResponse : null;
    return {
      ok: {
        paid: outcome.paymentMade,
        receipt:
          receipt === null
            ? null
            : {
                transaction: receipt.transaction,
                network: receipt.network,
                payer: receipt.payer ?? null,
              },
        resource: identity.resource,
        type: "mcp",
        toolName: identity.toolName,
        status: null,
        result: outcome.content.length === 1 && text !== "" ? parseBody(text) : outcome.content,
      },
    };
  } catch (error) {
    if (declined !== null) return { err: declined };
    const message = (error as Error).message;
    if (
      message.includes("Payment request denied") ||
      message.includes("filtered out by policies")
    ) {
      return {
        err: mcpError(
          "walras_mcp_payment_declined_by_policy",
          "The client-side policy rejected the payment request.",
        ),
      };
    }
    return { err: mcpError("walras_mcp_tool_call_failed", message) };
  } finally {
    await handle.close().catch(() => undefined);
  }
}
