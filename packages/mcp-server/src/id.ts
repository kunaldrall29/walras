/**
 * Resource ids for search_resources / paid_call.
 *
 * A catalog listing's identity is the tuple `(type, resource, toolName)` —
 * DECISIONS D-024, FACTS F-029. The id is that tuple, versioned and
 * base64url-encoded (DECISIONS D-029): deterministic (same listing → same id
 * across servers and restarts, no id table to keep), self-describing
 * (paid_call recovers the tuple without a lookup), and honest (an id never
 * outlives the listing — paid_call re-checks the catalog before paying).
 *
 * Format: `wr1:` + base64url(JSON.stringify([type, resource, toolName])).
 */

const PREFIX = "wr1:";

/** The decoded identity of a catalog listing. */
export interface ResourceIdentity {
  type: "http" | "mcp";
  resource: string;
  /** MCP tool name; empty string for HTTP resources (FACTS F-029). */
  toolName: string;
}

/**
 * Mints the deterministic id for a listing identity.
 *
 * @param identity - The listing identity tuple.
 * @returns The versioned, base64url-encoded id.
 */
export function mintResourceId(identity: ResourceIdentity): string {
  const json = JSON.stringify([identity.type, identity.resource, identity.toolName]);
  return PREFIX + Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Parses a resource id back to its identity tuple.
 *
 * Strict on every axis: prefix, base64url payload, JSON shape (an array of
 * exactly three strings), and the type discriminator. Anything else is null —
 * the caller maps that to `walras_mcp_unknown_resource_id`.
 *
 * @param id - The id to parse.
 * @returns The identity, or null when the id is not one this server minted.
 */
export function parseResourceId(id: string): ResourceIdentity | null {
  if (!id.startsWith(PREFIX)) return null;
  const encoded = id.slice(PREFIX.length);
  if (encoded.length === 0 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  const [type, resource, toolName] = parsed;
  if (type !== "http" && type !== "mcp") return null;
  if (typeof resource !== "string" || resource.length === 0) return null;
  if (typeof toolName !== "string") return null;
  if (type === "mcp" && toolName.length === 0) return null;
  if (type === "http" && toolName.length !== 0) return null;

  return { type, resource, toolName };
}
