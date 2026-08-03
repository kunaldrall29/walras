/**
 * Machine-readable rejection codes for the walras facilitator.
 *
 * Two disjoint taxonomies live here, per DECISIONS D-007:
 *
 *  1. `PACKAGE_*_REASON_CODES` — the 37 codes emitted by `ExactStellarScheme` in
 *     `@x402/stellar` (FACTS F-045, EVIDENCE S0-6). These are inherited verbatim and
 *     passed through untouched. walras never invents a parallel code for a rejection
 *     the package already names.
 *
 *  2. `WALRAS_REASON_CODES` — codes for the surface the package is silent about:
 *     request envelope validation, kind routing, and unexpected wrapper faults.
 *     All are prefixed `walras_` so a client can tell at a glance whether a rejection
 *     came from the payment mechanism or from the HTTP wrapper around it.
 *
 * Every code in both taxonomies has an entry in `REASON_TEXT`. The routes use it to
 * guarantee RFP 3.6's "non-null reason on every rejection": the package populates a
 * human-readable message on only one of its paths, so walras backfills the rest into
 * `invalidMessage` / `errorMessage` without ever altering the machine-readable code.
 */

/**
 * Verify-path reason codes emitted by `@x402/stellar`'s `ExactStellarScheme`.
 * Enumerated from the pinned SHA; 30 codes (EVIDENCE S0-6).
 */
export const PACKAGE_VERIFY_REASON_CODES = [
  "invalid_x402_version",
  "unsupported_scheme",
  "network_mismatch",
  "invalid_network",
  "invalid_exact_stellar_payload_malformed",
  "invalid_exact_stellar_payload_wrong_operation",
  "invalid_exact_stellar_payload_unsafe_tx_or_op_source",
  "invalid_exact_stellar_payload_wrong_asset",
  "invalid_exact_stellar_payload_wrong_function_name",
  "invalid_exact_stellar_payload_facilitator_is_payer",
  "invalid_exact_stellar_payload_wrong_recipient",
  "invalid_exact_stellar_payload_wrong_amount",
  "invalid_exact_stellar_payload_simulation_failed",
  "invalid_exact_stellar_payload_fee_exceeds_maximum",
  "invalid_exact_stellar_payload_event_not_transfer",
  "invalid_exact_stellar_payload_event_missing_contract_id",
  "invalid_exact_stellar_payload_event_wrong_asset",
  "invalid_exact_stellar_payload_no_transfer_events",
  "invalid_exact_stellar_payload_multiple_transfers",
  "invalid_exact_stellar_payload_event_wrong_from",
  "invalid_exact_stellar_payload_event_wrong_to",
  "invalid_exact_stellar_payload_event_wrong_amount",
  "invalid_exact_stellar_payload_no_auth_entries",
  "invalid_exact_stellar_payload_unsupported_credential_type",
  "invalid_exact_stellar_payload_facilitator_in_auth",
  "invalid_exact_stellar_signature_expiration_too_far",
  "invalid_exact_stellar_payload_has_subinvocations",
  "invalid_exact_stellar_payload_missing_payer_signature",
  "invalid_exact_stellar_payload_unexpected_pending_signatures",
  "unexpected_verify_error",
] as const;

/**
 * Settle-path reason codes emitted by `@x402/stellar`'s `ExactStellarScheme`.
 * Enumerated from the pinned SHA; 7 codes (EVIDENCE S0-6).
 */
export const PACKAGE_SETTLE_REASON_CODES = [
  "verification_failed",
  "settle_exact_stellar_signer_selection_failed",
  "settle_exact_stellar_transaction_signing_failed",
  "settle_exact_stellar_fee_bump_signing_failed",
  "settle_exact_stellar_transaction_submission_failed",
  "settle_exact_stellar_transaction_failed",
  "unexpected_settle_error",
] as const;

/** All 37 inherited package codes, verify path then settle path. */
export const PACKAGE_REASON_CODES = [
  ...PACKAGE_VERIFY_REASON_CODES,
  ...PACKAGE_SETTLE_REASON_CODES,
] as const;

export type PackageReasonCode = (typeof PACKAGE_REASON_CODES)[number];

/**
 * Rejection codes originated by walras itself. These cover only the surface the
 * package does not: HTTP envelope validation and payment-kind routing.
 */
export const WALRAS_REASON_CODES = [
  /** Request body was absent, unparseable, or not a JSON object. */
  "walras_malformed_request_body",
  /** Body parsed but `paymentPayload` was missing or not an object. */
  "walras_missing_payment_payload",
  /** Body parsed but `paymentRequirements` was missing or not an object. */
  "walras_missing_payment_requirements",
  /** `paymentPayload.x402Version` is not a version this facilitator serves. */
  "walras_unsupported_x402_version",
  /** The (scheme, network) tuple is not among the kinds advertised by GET /supported. */
  "walras_unsupported_kind",
  /** No route is mounted at the requested method and path. */
  "walras_unknown_route",
  /** A discovery query parameter could not be interpreted (e.g. non-numeric limit). */
  "walras_invalid_query_parameter",
  /** GET /discovery/search was called without the required `query` parameter. */
  "walras_missing_search_query",
  /** A search cursor was malformed or minted for a different query/filter combination. */
  "walras_invalid_search_cursor",
  /** Unhandled fault inside the wrapper. Never a statement about the payment. */
  "walras_internal_error",
] as const;

export type WalrasReasonCode = (typeof WALRAS_REASON_CODES)[number];

export type ReasonCode = PackageReasonCode | WalrasReasonCode;

/**
 * Human-readable text for every code in both taxonomies.
 *
 * These are explanations, never machine contracts — branch on the code, not on this
 * string. Package-code text paraphrases the corresponding MUST in
 * `specs/schemes/exact/scheme_exact_stellar.md` at the pinned SHA.
 */
export const REASON_TEXT: Record<ReasonCode, string> = {
  // ---- package: protocol validation -------------------------------------------------
  invalid_x402_version: "The payment payload declares an x402 version this scheme does not support.",
  unsupported_scheme:
    "The scheme in the payment payload or the requirements is not 'exact'.",
  network_mismatch:
    "paymentPayload.accepted.network does not match paymentRequirements.network.",
  invalid_network: "The requested network is not a known Stellar network.",

  // ---- package: transaction structure -----------------------------------------------
  invalid_exact_stellar_payload_malformed:
    "payload.transaction is missing or is not decodable as Stellar transaction XDR.",
  invalid_exact_stellar_payload_wrong_operation:
    "The transaction must carry exactly one invokeHostFunction operation invoking a contract.",
  invalid_exact_stellar_payload_unsafe_tx_or_op_source:
    "The transaction or operation source is a facilitator signing address, which is not permitted.",
  invalid_exact_stellar_payload_wrong_asset:
    "The invoked contract address does not match paymentRequirements.asset.",
  invalid_exact_stellar_payload_wrong_function_name:
    "The invoked function is not transfer(from, to, amount) with exactly three arguments.",
  invalid_exact_stellar_payload_facilitator_is_payer:
    "The transfer 'from' address is a facilitator signing address, which is not permitted.",
  invalid_exact_stellar_payload_wrong_recipient:
    "The transfer 'to' address does not equal paymentRequirements.payTo.",
  invalid_exact_stellar_payload_wrong_amount:
    "The transfer amount does not equal paymentRequirements.amount exactly.",

  // ---- package: simulation and fees --------------------------------------------------
  invalid_exact_stellar_payload_simulation_failed:
    "Re-simulation of the transaction against current ledger state did not succeed.",
  invalid_exact_stellar_payload_fee_exceeds_maximum:
    "The simulation-derived settlement fee exceeds the configured maxTransactionFeeStroops ceiling.",

  // ---- package: simulation events ----------------------------------------------------
  invalid_exact_stellar_payload_event_not_transfer:
    "A contract event emitted by the simulation is not a SEP-41 transfer event.",
  invalid_exact_stellar_payload_event_missing_contract_id:
    "A simulation transfer event carries no contract id.",
  invalid_exact_stellar_payload_event_wrong_asset:
    "A simulation transfer event was emitted by a contract other than the required asset.",
  invalid_exact_stellar_payload_no_transfer_events:
    "The simulation emitted no transfer event, so no balance change could be confirmed.",
  invalid_exact_stellar_payload_multiple_transfers:
    "The simulation emitted more than one transfer event; only the single expected transfer is allowed.",
  invalid_exact_stellar_payload_event_wrong_from:
    "The simulated transfer debits an address other than the payer named in the transaction.",
  invalid_exact_stellar_payload_event_wrong_to:
    "The simulated transfer credits an address other than paymentRequirements.payTo.",
  invalid_exact_stellar_payload_event_wrong_amount:
    "The simulated transfer moves an amount other than paymentRequirements.amount.",

  // ---- package: authorization entries -------------------------------------------------
  invalid_exact_stellar_payload_no_auth_entries:
    "The invokeHostFunction operation carries no authorization entries.",
  invalid_exact_stellar_payload_unsupported_credential_type:
    "An authorization entry uses credentials other than sorobanCredentialsAddress.",
  invalid_exact_stellar_payload_facilitator_in_auth:
    "A facilitator address appears in an authorization entry, which is not permitted.",
  invalid_exact_stellar_signature_expiration_too_far:
    "An authorization entry expires beyond currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds).",
  invalid_exact_stellar_payload_has_subinvocations:
    "An authorization entry authorizes sub-invocations beyond the transfer itself.",
  invalid_exact_stellar_payload_missing_payer_signature:
    "The payer's authorization entry is unsigned.",
  invalid_exact_stellar_payload_unexpected_pending_signatures:
    "One or more authorization entries still await a signature.",

  unexpected_verify_error: "Verification failed with an unexpected error inside the payment scheme.",

  // ---- package: settle path -------------------------------------------------------------
  verification_failed:
    "Settle re-ran verification independently, as the spec requires, and verification did not pass.",
  settle_exact_stellar_signer_selection_failed:
    "No facilitator signing account could be selected to source the settlement transaction.",
  settle_exact_stellar_transaction_signing_failed:
    "The facilitator could not sign the rebuilt settlement transaction.",
  settle_exact_stellar_fee_bump_signing_failed:
    "The facilitator could not sign the fee-bump wrapper for the settlement transaction.",
  settle_exact_stellar_transaction_submission_failed:
    "The settlement transaction was rejected when submitted to the Stellar network.",
  settle_exact_stellar_transaction_failed:
    "The settlement transaction was submitted but did not reach SUCCESS on-chain.",
  unexpected_settle_error: "Settlement failed with an unexpected error inside the payment scheme.",

  // ---- walras wrapper ---------------------------------------------------------------------
  walras_malformed_request_body:
    "The request body was absent, was not valid JSON, or was not a JSON object.",
  walras_missing_payment_payload:
    "The request body has no 'paymentPayload' object. See x402 v2 spec section 7.1.",
  walras_missing_payment_requirements:
    "The request body has no 'paymentRequirements' object. See x402 v2 spec section 7.1.",
  walras_unsupported_x402_version:
    "paymentPayload.x402Version names a protocol version this facilitator does not serve.",
  walras_unsupported_kind:
    "The (scheme, network) pair is not advertised by this facilitator. See GET /supported.",
  walras_unknown_route:
    "No route is mounted at this method and path. This facilitator serves POST /verify, POST /settle, GET /supported, GET /discovery/resources, GET /discovery/search, and GET /health.",
  walras_invalid_query_parameter:
    "A query parameter could not be interpreted. limit and offset must be non-negative integers; filter parameters must not repeat.",
  walras_missing_search_query:
    "GET /discovery/search requires a non-empty 'query' parameter. See specs/extensions/bazaar.md — the parameter is named 'query', not 'q'.",
  walras_invalid_search_cursor:
    "The 'cursor' parameter is not a cursor this facilitator issued for this query and filter combination. Repeat the search without a cursor to start a new walk.",
  walras_internal_error:
    "The facilitator failed to process the request. This says nothing about the payment's validity.",
};

/** Every code this facilitator can emit, from either taxonomy. */
export const ALL_REASON_CODES: readonly ReasonCode[] = [
  ...PACKAGE_REASON_CODES,
  ...WALRAS_REASON_CODES,
];

/**
 * Looks up the human-readable text for a reason code.
 *
 * Falls back to a generic sentence for codes not in the table, so a code introduced by
 * an upstream package version still yields a non-null reason rather than `undefined`.
 * Such a gap is a drift signal — `reason-codes.test.ts` fails on it.
 *
 * @param code - A machine-readable reason code from either taxonomy.
 * @returns Human-readable explanation of the rejection; never empty.
 */
export function reasonText(code: string): string {
  return (
    REASON_TEXT[code as ReasonCode] ??
    `The payment was rejected with reason code '${code}', which this facilitator build does not have explanatory text for.`
  );
}

/**
 * Type guard for codes owned by walras rather than inherited from `@x402/stellar`.
 *
 * @param code - The reason code to classify.
 * @returns True when the code was originated by the wrapper.
 */
export function isWalrasReasonCode(code: string): code is WalrasReasonCode {
  return (WALRAS_REASON_CODES as readonly string[]).includes(code);
}

/**
 * A rejection raised by the wrapper before the payment scheme is ever consulted.
 * Carries the HTTP status the route should use alongside the machine-readable code.
 */
export class WalrasRejection extends Error {
  readonly code: WalrasReasonCode;
  readonly httpStatus: number;
  /** Optional extra context appended to the canonical reason text. */
  readonly detail: string | undefined;

  /**
   * Creates a wrapper-level rejection.
   *
   * @param code - The machine-readable walras reason code.
   * @param options - Optional overrides.
   * @param options.httpStatus - HTTP status to respond with (default 400).
   * @param options.detail - Extra context appended to the canonical reason text.
   */
  constructor(code: WalrasReasonCode, options: { httpStatus?: number; detail?: string } = {}) {
    const detail = options.detail;
    super(detail ? `${reasonText(code)} ${detail}` : reasonText(code));
    this.name = "WalrasRejection";
    this.code = code;
    this.httpStatus = options.httpStatus ?? 400;
    this.detail = detail;
  }

  /** The non-null human-readable reason for this rejection. */
  get reason(): string {
    return this.message;
  }
}
