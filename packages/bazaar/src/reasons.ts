/**
 * Machine-readable rejection codes for the Bazaar indexing path.
 *
 * These are a third, disjoint taxonomy alongside the two in
 * `@walras/facilitator`'s errors.ts (DECISIONS D-007): they never appear in a
 * `VerifyResponse` or `SettleResponse`, only inside the `bazaar` object of the
 * `EXTENSION-RESPONSES` header. The spec types `bazaar.rejectedReason` as
 * human-readable (FACTS F-024), so per DECISIONS D-014 each rejection carries
 * BOTH: the human string in `rejectedReason` and the machine code in an
 * additive `code` field. The stock `@x402/core` facilitator client's header
 * log allowlist is `["status", "rejectedReason", "reason", "code"]`, so the
 * machine code is visible to unmodified consumers.
 *
 * Every code names a defect in the *client's* payload. Internal indexer
 * faults (database down, unexpected exception) are deliberately NOT here:
 * those omit the header entirely (a MAY per F-024; DECISIONS D-015) rather
 * than blaming the client for a walras fault.
 */

/** Rejection codes for client-attributable indexing soft-drops. */
export const BAZAAR_REJECT_CODES = [
  /** `extensions.bazaar` is present but is not a JSON object. */
  "bazaar_extension_not_object",
  /** The `extensions` object exceeds the indexer's size cap. */
  "bazaar_extensions_too_large",
  /** `info` failed protocol-invariant validation (input.type, methods, MCP fields). */
  "bazaar_spec_validation_failed",
  /** `info` failed validation against the extension's own `schema` (spec MUST, F-024). */
  "bazaar_schema_validation_failed",
  /** The extension's `schema` exceeds the indexer's node budget (ReDoS/complexity guard). */
  "bazaar_schema_too_complex",
  /** `resource.url` is missing or is not a well-formed absolute http(s) URL. */
  "bazaar_resource_url_invalid",
  /** The (resource, type, toolName) listing is owned by a different verified payTo. */
  "bazaar_listing_owned_by_other_payee",
] as const;

export type BazaarRejectCode = (typeof BAZAAR_REJECT_CODES)[number];

/**
 * Human-readable text for every rejection code, used to populate the spec's
 * `rejectedReason` field. Non-null for every code by construction, honouring
 * the project rule that every rejection path carries a non-null reason.
 */
export const BAZAAR_REJECT_TEXT: Record<BazaarRejectCode, string> = {
  bazaar_extension_not_object:
    "The bazaar extension must be a JSON object with 'info' and 'schema' fields.",
  bazaar_extensions_too_large:
    "The extensions object exceeds the 64 KiB indexing limit and was not cataloged.",
  bazaar_spec_validation_failed:
    "The discovery info violates the bazaar protocol invariants.",
  bazaar_schema_validation_failed:
    "The discovery info failed schema validation.",
  bazaar_schema_too_complex:
    "The discovery schema is too large or deeply nested to validate within the indexer's bounds.",
  bazaar_resource_url_invalid:
    "resource.url must be an absolute http(s) URL without credentials.",
  bazaar_listing_owned_by_other_payee:
    "This resource is already cataloged for a different payment recipient; " +
    "a listing can only be updated by payments to its original payTo.",
};
