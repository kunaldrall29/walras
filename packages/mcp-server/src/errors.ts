/**
 * Machine-readable error codes for the walras MCP server.
 *
 * Contract (DECISIONS D-028): a tool NEVER throws for a domain failure and
 * NEVER returns free-text-only errors. Every rejection is a tool result with
 * `isError: true` whose `structuredContent` (and `content[0].text`, the
 * JSON-stringified same object — mirroring the dual-format rule the MCP
 * transport spec imposes on 402s, FACTS F-079) is:
 *
 *   { "errorCode": "<machine code>", "reason": "<non-null human text>" }
 *
 * Two taxonomies appear in `errorCode`, mirroring the facilitator's D-007
 * split:
 *
 *  1. Facilitator/package codes, passed through VERBATIM whenever the
 *     rejection originated there — a `walras_*` envelope code from a
 *     discovery endpoint, or one of the 37 `@x402/stellar` scheme codes
 *     arriving in a settle receipt's `errorReason`. walras never invents a
 *     parallel code for a rejection the facilitator already names.
 *
 *  2. `walras_mcp_*` codes for the surface only this server owns: argument
 *     validation, resource-id resolution, reachability, the spend-cap
 *     policy, and payment outcomes the upstream left uncoded.
 */

import { ALL_REASON_CODES, reasonText } from "@walras/facilitator";

/** Codes originated by the MCP server itself. */
export const WALRAS_MCP_REASON_CODES = [
  /** paid_call needs a wallet; CLIENT_STELLAR_PRIVATE_KEY is not configured. */
  "walras_mcp_wallet_not_configured",
  /** Tool arguments failed cross-field validation (schemas catch the rest). */
  "walras_mcp_invalid_arguments",
  /** A resourceId did not decode, or decoded to a listing the catalog does not have. */
  "walras_mcp_unknown_resource_id",
  /** The walras facilitator could not be reached at the transport level. */
  "walras_mcp_facilitator_unreachable",
  /** The facilitator answered a discovery request with an error this server cannot name. */
  "walras_mcp_search_failed",
  /** The target resource could not be reached at the transport level. */
  "walras_mcp_resource_unreachable",
  /** The target resource answered with a non-402 error before any payment. */
  "walras_mcp_resource_error",
  /** The 402 asked for more than the configured spend cap; nothing was paid. */
  "walras_mcp_payment_declined_by_policy",
  /** A payment was attempted but no successful settle receipt came back. */
  "walras_mcp_payment_not_settled",
  /** An MCP tool call to the target server failed after connecting. */
  "walras_mcp_tool_call_failed",
  /** Unhandled fault inside this server. Never a statement about the payment. */
  "walras_mcp_internal_error",
] as const;

export type WalrasMcpReasonCode = (typeof WALRAS_MCP_REASON_CODES)[number];

/** Human-readable text for every walras_mcp_* code. Explanations, not contracts. */
export const WALRAS_MCP_REASON_TEXT: Record<WalrasMcpReasonCode, string> = {
  walras_mcp_wallet_not_configured:
    "paid_call requires a wallet. Set CLIENT_STELLAR_PRIVATE_KEY (an S... ed25519 seed) in the environment of this MCP server. search_resources works without one.",
  walras_mcp_invalid_arguments:
    "The tool arguments are inconsistent. Provide either resourceId (from search_resources) or url — plus toolName when the target is an MCP tool.",
  walras_mcp_unknown_resource_id:
    "resourceId does not decode to a listing this catalog has. Re-run search_resources and use an id from its results.",
  walras_mcp_facilitator_unreachable:
    "The walras facilitator did not answer at the transport level. Check FACILITATOR_URL and that the facilitator is running.",
  walras_mcp_search_failed:
    "The facilitator rejected the discovery request without a machine-readable code this server recognizes.",
  walras_mcp_resource_unreachable:
    "The target resource did not answer at the transport level.",
  walras_mcp_resource_error:
    "The target resource answered with an error that is not a payment challenge. No payment was made.",
  walras_mcp_payment_declined_by_policy:
    "The payment demanded exceeds this server's spend cap. Nothing was paid. Raise WALRAS_MCP_MAX_AMOUNT (USDC base units, 7 decimals) to allow it.",
  walras_mcp_payment_not_settled:
    "A payment was attempted but no successful settlement receipt came back.",
  walras_mcp_tool_call_failed:
    "The MCP tool call to the target server failed.",
  walras_mcp_internal_error:
    "This MCP server failed to process the request. This says nothing about the payment's validity.",
};

/** The wire shape of every rejection this server emits. */
export interface StructuredError {
  errorCode: string;
  reason: string;
}

const FACILITATOR_CODES: readonly string[] = ALL_REASON_CODES;

/**
 * Whether a code belongs to the facilitator's enum (envelope or scheme code),
 * i.e. can be passed through verbatim with its canonical text.
 *
 * @param code - Candidate code from an upstream response.
 * @returns True when the facilitator taxonomy owns the code.
 */
export function isFacilitatorCode(code: string): boolean {
  return FACILITATOR_CODES.includes(code);
}

/**
 * Builds the structured error for a walras_mcp_* code.
 *
 * @param code - The machine-readable code.
 * @param detail - Optional extra context appended to the canonical text.
 * @returns The wire-shaped error object.
 */
export function mcpError(code: WalrasMcpReasonCode, detail?: string): StructuredError {
  const base = WALRAS_MCP_REASON_TEXT[code];
  return { errorCode: code, reason: detail ? `${base} ${detail}` : base };
}

/**
 * Builds the structured error for a code the facilitator originated,
 * passing the code through verbatim (D-028 taxonomy 1).
 *
 * @param code - The facilitator/package reason code.
 * @param upstreamReason - Reason text the upstream sent, if any; wins over
 *   the canonical text because it may carry request-specific detail.
 * @returns The wire-shaped error object.
 */
export function facilitatorError(code: string, upstreamReason?: string): StructuredError {
  return {
    errorCode: code,
    reason:
      upstreamReason !== undefined && upstreamReason !== "" ? upstreamReason : reasonText(code),
  };
}
