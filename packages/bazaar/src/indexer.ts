import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  BAZAAR,
  isValidRouteTemplate,
  sanitizeResourceServiceMetadata,
  validateDiscoveryExtension,
  validateDiscoveryExtensionSpec,
  type DiscoveryExtension,
} from "@x402/extensions/bazaar";
import { BAZAAR_REJECT_TEXT, type BazaarRejectCode } from "./reasons.js";
import type { BazaarStore, UpsertResult } from "./store.js";

/**
 * The settle-success indexing path — the catalog's trust boundary.
 *
 * Everything in `PaymentPayload` except the settled payment itself is
 * client-controlled: the client echoes `resource` and `extensions` from the
 * seller's 402, and a hostile client can substitute anything (spec §Service
 * Metadata: "clients echo the resource block ... so a malicious client could
 * submit hostile metadata to poison the catalog"). This module treats every
 * such field as hostile and admits it only through validation.
 *
 * Why this composes the SDK's low-level helpers instead of calling its
 * all-in-one `extractDiscoveryInfo` (FACTS F-072):
 *
 *  1. `extractDiscoveryInfo` validates `info` only against the CLIENT-supplied
 *     `schema`. A hostile client can send a trivial schema that validates
 *     anything, so schema validation alone is not a trust boundary. The
 *     protocol-invariant check (`validateDiscoveryExtensionSpec`) is exported
 *     but never called by it — here it is mandatory.
 *  2. It reports failures via `console.warn` and returns null, discarding the
 *     reason. The EXTENSION-RESPONSES contract (FACTS F-024, DECISIONS D-014)
 *     needs the reason on the wire.
 *  3. It calls `new URL(resource.url)` unguarded and throws on a missing or
 *     malformed URL — an uncaught path this module must not have.
 *
 * The invariant (DECISIONS D-015): this function NEVER throws, and all of its
 * work is synchronous and bounded — the 64 KiB extensions cap bounds Ajv
 * compile/validate cost, and the store's 100 ms busy timeout bounds the only
 * blocking database edge — so a settlement response is never failed or
 * meaningfully delayed by indexing.
 */

/** Upper bound on the serialized `extensions` object the indexer will process. */
export const MAX_EXTENSIONS_BYTES = 64 * 1024;

/** Soft-drop caps for echoed free-text resource fields (hardening, not spec). */
const MAX_DESCRIPTION_LEN = 2048;
const MAX_MIME_TYPE_LEN = 255;
const MAX_RESOURCE_URL_LEN = 2048;

/** Outcome of one indexing attempt, discriminated for the header encoder. */
export type IndexOutcome =
  /** Validated and written to the catalog. */
  | {
      status: "indexed";
      resource: string;
      type: "http" | "mcp";
      toolName: string;
      upsert: Exclude<UpsertResult, { outcome: "ownership_conflict" }>["outcome"];
    }
  /** Client-attributable soft-drop; maps to `status: "rejected"` on the wire. */
  | { status: "rejected"; code: BazaarRejectCode; reason: string; detail?: string }
  /** Nothing to catalog — no bazaar extension, or not a v2 payload (F-032). No header. */
  | { status: "skipped"; why: "no_extension" | "not_v2" }
  /** Internal walras fault. No header (D-015); the error is for the server log. */
  | { status: "error"; error: unknown };

/**
 * Builds a rejection outcome, joining the machine code with its guaranteed
 * non-null human-readable text.
 *
 * @param code - The machine-readable rejection code.
 * @param detail - Optional specifics appended to the human reason.
 * @returns The rejection outcome.
 */
function rejected(code: BazaarRejectCode, detail?: string): IndexOutcome {
  const base = BAZAAR_REJECT_TEXT[code];
  return {
    status: "rejected",
    code,
    reason: detail === undefined ? base : `${base} ${detail}`,
    detail,
  };
}

/**
 * Narrows an unknown value to a plain JSON object.
 *
 * @param value - The value to test.
 * @returns True when the value is a non-null, non-array object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a client-supplied resource URL and returns it parsed.
 *
 * Accepts exactly what the catalog can serve: an absolute http(s) URL of
 * bounded length with no embedded credentials and no control characters.
 * Host-level SSRF checks (loopback, IP literals) are deliberately NOT applied
 * here — they belong to `iconUrl` (which a facilitator might fetch, F-031);
 * `resource.url` is a catalog key the facilitator never dereferences, and
 * rejecting loopback would break every local development seller.
 *
 * @param raw - The raw `resource.url` value from the payload.
 * @returns The parsed URL, or undefined when invalid.
 */
function parseResourceUrl(raw: unknown): URL | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RESOURCE_URL_LEN) {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  return url;
}

/**
 * Bounds an echoed free-text field: strings within the cap pass through,
 * anything else is soft-dropped.
 *
 * @param value - The raw field value.
 * @param maxLen - Maximum permitted length.
 * @returns The value, or undefined when dropped.
 */
function boundedString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLen) return undefined;
  return value;
}

/**
 * Indexes one successfully settled payment into the catalog.
 *
 * Never throws. Every rejection carries a machine code and a non-null
 * human-readable reason. The listing identity is bound to
 * `paymentRequirements.payTo` — the recipient the payment scheme verified
 * against the on-chain transfer (FACTS F-035) and that the settlement just
 * paid — so a client cannot create or overwrite another seller's listing
 * (DECISIONS D-024).
 *
 * @param store - The catalog store to write to.
 * @param paymentPayload - The payload of the settled payment (hostile input).
 * @param paymentRequirements - The requirements the scheme verified and settled.
 * @param settledAt - ISO 8601 timestamp for this settlement.
 * @returns The indexing outcome, for the EXTENSION-RESPONSES encoder.
 */
export function indexSettledPayment(
  store: BazaarStore,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  settledAt: string,
): IndexOutcome {
  try {
    // F-032 / bazaar.md §Client Behavior: no echoed extension, no cataloging.
    // v1 payloads carry discovery in outputSchema; walras does not support v1
    // (bazaar.md §Backwards Compatibility: "Facilitators are not expected to
    // support v1"), and the payment path would have rejected them anyway.
    if (paymentPayload.x402Version !== 2) {
      return { status: "skipped", why: "not_v2" };
    }
    const extensions = paymentPayload.extensions;
    if (!isObject(extensions) || !(BAZAAR.key in extensions)) {
      return { status: "skipped", why: "no_extension" };
    }

    // Size cap before any expensive work: bounds Ajv compile/validate cost on
    // hostile schemas (the budget invariant's structural enforcement) and the
    // stored row size. Serialization cannot throw here — the object was
    // produced by JSON.parse, so it is acyclic and BigInt-free.
    if (JSON.stringify(extensions).length > MAX_EXTENSIONS_BYTES) {
      return rejected("bazaar_extensions_too_large");
    }

    const rawExtension = extensions[BAZAAR.key];
    if (!isObject(rawExtension)) {
      return rejected("bazaar_extension_not_object");
    }

    // Spec MUST (F-024 §Facilitator Behavior step 1): validate info against
    // the supplied schema. A missing or uncompilable schema fails closed
    // inside the helper. This check alone is NOT a trust boundary — the
    // client authors the schema — hence the invariant check that follows.
    const schemaResult = validateDiscoveryExtension(rawExtension as unknown as DiscoveryExtension);
    if (!schemaResult.valid) {
      return rejected("bazaar_schema_validation_failed", schemaResult.errors?.join("; "));
    }

    // Protocol invariants the client cannot relax by weakening its own
    // schema: input.type ∈ {http, mcp}, method enums, MCP toolName +
    // inputSchema. FACTS F-072: the SDK's one-shot extractor skips this.
    const specResult = validateDiscoveryExtensionSpec(rawExtension);
    if (!specResult.valid) {
      return rejected("bazaar_spec_validation_failed", specResult.errors?.join("; "));
    }

    const url = parseResourceUrl(paymentPayload.resource?.url);
    if (url === undefined) {
      return rejected("bazaar_resource_url_invalid");
    }

    const info = (rawExtension as unknown as DiscoveryExtension).info;
    const inputType = info.input.type;

    // routeTemplate (F-030): percent-decoding precedes the ".." and "://"
    // checks inside isValidRouteTemplate. An invalid template is a FIELD
    // soft-drop — the spec says fall back to the concrete URL path, not
    // reject the listing. MCP routes are never parameterized (F-051).
    let routeTemplate: string | undefined;
    if (inputType === "http") {
      const rawTemplate = rawExtension.routeTemplate;
      if (typeof rawTemplate === "string" && isValidRouteTemplate(rawTemplate)) {
        routeTemplate = rawTemplate;
      }
    }

    // Canonical catalog URL (F-051 semantics): origin + template-or-pathname;
    // query string and fragment are stripped.
    const canonical = `${url.origin}${routeTemplate ?? url.pathname}`;

    const toolName =
      inputType === "mcp" ? (info.input as { toolName: string }).toolName : "";

    // Service metadata soft-drop rules (F-031) via the SDK's shared helpers;
    // description/mimeType get the same treatment with local bounds since the
    // spec assigns them no rules but the catalog stores them.
    const metadata = sanitizeResourceServiceMetadata(paymentPayload.resource);

    const result = store.upsertFromSettlement({
      resource: canonical,
      type: inputType,
      toolName,
      payTo: paymentRequirements.payTo,
      x402Version: paymentPayload.x402Version,
      description: boundedString(paymentPayload.resource?.description, MAX_DESCRIPTION_LEN),
      mimeType: boundedString(paymentPayload.resource?.mimeType, MAX_MIME_TYPE_LEN),
      serviceName: metadata.serviceName,
      tags: metadata.tags,
      iconUrl: metadata.iconUrl,
      extensions,
      requirements: paymentRequirements,
      settledAt,
    });

    if (result.outcome === "ownership_conflict") {
      return rejected("bazaar_listing_owned_by_other_payee");
    }

    return {
      status: "indexed",
      resource: canonical,
      type: inputType,
      toolName,
      upsert: result.outcome,
    };
  } catch (error) {
    return { status: "error", error };
  }
}
