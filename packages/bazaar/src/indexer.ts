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
import type { BazaarStore, SoftDrop, UpsertResult } from "./store.js";

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
 * work is synchronous and bounded. Boundedness has two teeth, because the
 * 64 KiB byte cap alone is NOT enough — a sub-kilobyte schema carrying a
 * catastrophic-backtracking regex can make Ajv burn minutes of CPU (a real
 * ReDoS on the settle response path). So the indexer (1) strips every regex-
 * bearing schema keyword and caps schema node count before Ajv ever compiles
 * (see `boundSchemaForValidation` / REGEX_SCHEMA_KEYWORDS), leaving validation
 * linear in the byte-capped `info`, and (2) leans on the store's 100 ms busy
 * timeout for the only blocking database edge. With no compiled `RegExp` in
 * play, no input drives the work superlinear — so a settlement response is
 * never failed or meaningfully delayed by indexing.
 */

/** Upper bound on the serialized `extensions` object the indexer will process. */
export const MAX_EXTENSIONS_BYTES = 64 * 1024;

/**
 * Upper bound on the number of nodes in a client schema the indexer will
 * compile. A legitimate discovery schema is a few dozen nodes; this cap is a
 * backstop against a schema whose sheer size makes Ajv compilation expensive
 * even after regex keywords are removed.
 */
export const MAX_SCHEMA_NODES = 2000;

/**
 * JSON-Schema keywords whose values are regular expressions that Ajv compiles
 * to native `RegExp`. Left in place, a client can supply a catastrophic-
 * backtracking pattern (e.g. `^(a+)+$`) and a matching `info` value to make
 * `validateDiscoveryExtension` — which runs INLINE on the settle response path
 * (server.ts) — burn minutes of synchronous CPU on a sub-kilobyte payload,
 * stalling the single-threaded facilitator after the on-chain transfer has
 * already committed. The 64 KiB byte cap does NOT bound regex runtime, so the
 * indexer strips these before compiling. Schema validation of `info` is not
 * the trust boundary in any case (the protocol-invariant check that follows
 * is, FACTS F-072) — dropping a `pattern` constraint only loosens shape
 * validation, it never admits a malformed listing. `patternProperties` is an
 * object keyed BY regexes, so the whole keyword is dropped rather than
 * recursed into.
 */
const REGEX_SCHEMA_KEYWORDS = new Set(["pattern", "patternProperties", "format"]);

/**
 * Returns a deep copy of a client-supplied JSON schema with every regex-
 * bearing keyword removed and the node count bounded. This is what makes the
 * indexer's Ajv compile+validate genuinely bounded work (DECISIONS D-015):
 * with no `RegExp` in the compiled validator, validation is linear in the
 * (already byte-capped) `info`, so no input can make it superlinear.
 *
 * A schema that is absent or a non-object is returned as-is (with `ok: true`)
 * so the downstream `validateDiscoveryExtension` still fails it closed with
 * `bazaar_schema_validation_failed` — only an over-budget schema returns
 * `ok: false`, keeping the two rejection reasons distinct.
 *
 * @param schema - The raw, hostile `extension.schema` value.
 * @returns `{ ok: true, schema }` sanitized, or `{ ok: false }` when over budget.
 */
function boundSchemaForValidation(
  schema: unknown,
): { ok: true; schema: unknown } | { ok: false } {
  let budget = MAX_SCHEMA_NODES;
  const walk = (node: unknown): unknown => {
    if (--budget < 0) throw new RangeError("schema node budget exceeded");
    if (Array.isArray(node)) return node.map(walk);
    if (isObject(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (REGEX_SCHEMA_KEYWORDS.has(key)) continue;
        out[key] = walk(value);
      }
      return out;
    }
    return node;
  };
  try {
    return { ok: true, schema: walk(schema) };
  } catch {
    return { ok: false };
  }
}

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

/** Maximum percent-decode passes when hardening a routeTemplate. */
const MAX_ROUTE_DECODE_PASSES = 5;

/**
 * Walras-side routeTemplate hardening, applied BEFORE the SDK's
 * `isValidRouteTemplate` and required by the RFP (task 3.B) over and above
 * what the shipped SDK check does. The SDK decodes exactly once, so
 * double-encoded traversal (`%252e%252e`), a percent-encoded null byte
 * (`%00`), and protocol-relative authorities (`//host`) all survive it
 * (reproduced against the installed dist). This routine closes those:
 *
 *  - bounded REPEATED percent-decode (catches `%25…` layered encodings),
 *    rejecting if any decoded form contains `..`, `://`, a backslash, a
 *    control character (covers a decoded null byte), or begins `//`
 *    (protocol-relative), or if decoding does not stabilize within the bound;
 *  - the raw form is still required to pass the SDK regex/charset check.
 *
 * A rejected template is a FIELD soft-drop (F-030): the caller falls back to
 * the concrete URL path and still catalogs the listing.
 *
 * @param raw - The client-echoed `routeTemplate` value.
 * @returns The accepted raw template, or undefined to soft-drop it.
 */
function hardenRouteTemplate(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  let current = raw;
  for (let pass = 0; pass <= MAX_ROUTE_DECODE_PASSES; pass++) {
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(current)) return undefined;
    if (current.includes("..")) return undefined;
    if (current.includes("://")) return undefined;
    if (current.includes("\\")) return undefined;
    if (current.startsWith("//")) return undefined;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return undefined;
    }
    if (next === current) {
      // Stabilized and clean at every layer; the SDK check enforces the
      // canonical charset / leading-slash / regex shape on the raw form.
      return isValidRouteTemplate(raw) ? raw : undefined;
    }
    current = next;
  }
  // Did not stabilize within the decode bound — treat as hostile.
  return undefined;
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

    // Bound the client schema before it reaches Ajv: strip regex keywords and
    // cap node count so compile+validate cannot be driven superlinear by a
    // catastrophic-backtracking pattern (the ReDoS that would otherwise stall
    // the settle response path — see REGEX_SCHEMA_KEYWORDS).
    const bounded = boundSchemaForValidation((rawExtension as { schema?: unknown }).schema);
    if (!bounded.ok) {
      return rejected("bazaar_schema_too_complex");
    }
    const guardedExtension = { ...rawExtension, schema: bounded.schema };

    // Spec MUST (F-024 §Facilitator Behavior step 1): validate info against
    // the supplied schema. A missing or uncompilable schema fails closed
    // inside the helper. This check alone is NOT a trust boundary — the
    // client authors the schema — hence the invariant check that follows.
    const schemaResult = validateDiscoveryExtension(guardedExtension as unknown as DiscoveryExtension);
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

    // Per-field soft-drops are logged (RFP task 3.A `soft_drops` table): a
    // field the client supplied but validation rejected is dropped
    // INDIVIDUALLY while the listing is still cataloged (F-030 semantics).
    const softDrops: SoftDrop[] = [];

    // routeTemplate (F-030 + RFP 3.B): the SDK's isValidRouteTemplate decodes
    // only once, so hardenRouteTemplate runs first — bounded repeated decode,
    // null-byte / backslash / protocol-relative rejection. An invalid template
    // is a FIELD soft-drop; fall back to the concrete URL path, don't reject
    // the listing. MCP routes are never parameterized (F-051).
    let routeTemplate: string | undefined;
    if (inputType === "http") {
      const rawTemplate = rawExtension.routeTemplate;
      if (typeof rawTemplate === "string" && rawTemplate.length > 0) {
        routeTemplate = hardenRouteTemplate(rawTemplate);
        if (routeTemplate === undefined) {
          softDrops.push({ field: "routeTemplate", reasonCode: "route_template_unsafe" });
        }
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
    const resource = paymentPayload.resource;
    const metadata = sanitizeResourceServiceMetadata(resource);
    const description = boundedString(resource?.description, MAX_DESCRIPTION_LEN);
    const mimeType = boundedString(resource?.mimeType, MAX_MIME_TYPE_LEN);
    if (resource?.serviceName !== undefined && metadata.serviceName === undefined) {
      softDrops.push({ field: "serviceName", reasonCode: "service_name_invalid" });
    }
    if (
      Array.isArray(resource?.tags) && resource.tags.length > 0 && metadata.tags === undefined
    ) {
      softDrops.push({ field: "tags", reasonCode: "tags_invalid" });
    }
    if (resource?.iconUrl !== undefined && metadata.iconUrl === undefined) {
      softDrops.push({ field: "iconUrl", reasonCode: "icon_url_invalid" });
    }
    if (resource?.description !== undefined && description === undefined) {
      softDrops.push({ field: "description", reasonCode: "description_invalid" });
    }
    if (resource?.mimeType !== undefined && mimeType === undefined) {
      softDrops.push({ field: "mimeType", reasonCode: "mime_type_invalid" });
    }

    const result = store.upsertFromSettlement({
      resource: canonical,
      type: inputType,
      toolName,
      payTo: paymentRequirements.payTo,
      x402Version: paymentPayload.x402Version,
      description,
      mimeType,
      serviceName: metadata.serviceName,
      tags: metadata.tags,
      iconUrl: metadata.iconUrl,
      extensions,
      requirements: paymentRequirements,
      settledAt,
      softDrops,
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
