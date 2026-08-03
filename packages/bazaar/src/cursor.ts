import { createHash } from "node:crypto";

/**
 * Opaque search cursor — the continuation token for `GET /discovery/search`
 * (DECISIONS D-027).
 *
 * A cursor is a keyset position, not an offset: it names the last row the
 * client saw as `(score, id)`, and the next page starts strictly after that
 * position in the (score DESC, id ASC) ranking. Under a static catalog this
 * walks the full result set exactly once — no skips, no duplicates —
 * regardless of page size. IEEE doubles survive the JSON round-trip exactly,
 * so the equality comparison on `score` is precise.
 *
 * The cursor also carries a hash of the (query, filters) context it was
 * minted for. A cursor replayed against a DIFFERENT query cannot mean
 * anything; the hash turns that mistake into a named 400
 * (`walras_invalid_search_cursor`) instead of a silently wrong page. This is
 * integrity against confusion, not secrecy — the cursor is decodable by
 * anyone, which is fine because it contains only a rank position.
 */

/** Cursor format version; bump on any change to the encoded shape. */
const CURSOR_VERSION = 1;

/** Decoded cursor contents. */
export interface SearchCursor {
  /** Context hash binding the cursor to one (query, filters) combination. */
  contextHash: string;
  /** Score of the last row the client saw. */
  score: number;
  /** Id of the last row the client saw. */
  id: number;
}

/** Raised when a cursor cannot be decoded or belongs to a different search. */
export class InvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCursorError";
  }
}

/**
 * Hashes the search context a cursor binds to.
 *
 * @param context - Query text plus the filter values, order-insensitive by
 *   construction (fixed key order below).
 * @returns A 16-hex-character digest.
 */
export function searchContextHash(context: {
  query: string;
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  extensions?: string;
}): string {
  const canonical = JSON.stringify([
    context.query,
    context.type ?? null,
    context.payTo ?? null,
    context.scheme ?? null,
    context.network ?? null,
    context.extensions ?? null,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
}

/**
 * Encodes a cursor as a base64url token.
 *
 * @param cursor - The cursor contents.
 * @returns The opaque token.
 */
export function encodeCursor(cursor: SearchCursor): string {
  const json = JSON.stringify({
    v: CURSOR_VERSION,
    h: cursor.contextHash,
    s: cursor.score,
    i: cursor.id,
  });
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decodes and validates a cursor token against the current search context.
 *
 * @param token - The client-supplied cursor, untrusted.
 * @param expectedContextHash - Hash of the current (query, filters).
 * @returns The decoded cursor.
 * @throws {InvalidCursorError} When the token is malformed, a different
 *   version, or minted for a different query/filter combination.
 */
export function decodeCursor(token: string, expectedContextHash: string): SearchCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError("cursor is not decodable");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { v?: unknown }).v !== CURSOR_VERSION
  ) {
    throw new InvalidCursorError("cursor has an unknown format or version");
  }
  const { h, s, i } = parsed as { h?: unknown; s?: unknown; i?: unknown };
  if (typeof h !== "string" || typeof s !== "number" || !Number.isFinite(s) || typeof i !== "number" || !Number.isInteger(i)) {
    throw new InvalidCursorError("cursor fields are malformed");
  }
  if (h !== expectedContextHash) {
    throw new InvalidCursorError("cursor was issued for a different query or filter combination");
  }
  return { contextHash: h, score: s, id: i };
}
