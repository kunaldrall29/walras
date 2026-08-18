/**
 * Search-text extraction from stored extension payloads.
 *
 * The searchable corpus for a listing is: service name, description, tags, and
 * the text extracted here from the echoed `extensions` object — parameter
 * NAMES and JSON-Schema `description` annotations, plus MCP tool names
 * (DECISIONS D-026). Example VALUES are deliberately not indexed: an example
 * city of "Zurich" would make every listing with that example match a Zurich
 * query, which says nothing about what the resource does.
 *
 * The walk is generic over the extension tree rather than shaped to the
 * HTTP/MCP variants, so all three declared forms — GET/HEAD/DELETE
 * `queryParams`, POST/PUT/PATCH `body`, and MCP `inputSchema` — contribute
 * through the same two rules: any `properties` object yields its property
 * names, and any string-valued `description` key yields its text. Input has
 * already passed the indexer's validation and 64 KiB cap; the depth and
 * character bounds here are belt-and-braces, not the trust boundary.
 */

/** Maximum object depth the walker descends. */
const MAX_DEPTH = 16;

/** Maximum characters of extracted text per listing. */
const MAX_CHARS = 8192;

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
 * Extracts searchable parameter text from a listing's extensions object.
 *
 * @param extensions - The stored `extensions` object, or undefined.
 * @returns Space-joined parameter names, schema descriptions, and tool names;
 *   empty string when there is nothing to extract.
 */
export function extractParamText(extensions: Record<string, unknown> | undefined): string {
  if (extensions === undefined) return "";
  const parts: string[] = [];
  let chars = 0;

  const push = (text: string): void => {
    if (text.length === 0 || chars >= MAX_CHARS) return;
    parts.push(text);
    chars += text.length + 1;
  };

  const walk = (node: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || chars >= MAX_CHARS) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if ((key === "description" || key === "toolName") && typeof value === "string") {
        push(value);
      } else if (key === "properties" && isObject(value)) {
        for (const propertyName of Object.keys(value)) push(propertyName);
        walk(value, depth + 1);
      } else {
        walk(value, depth + 1);
      }
    }
  };

  walk(extensions, 0);
  return parts.join(" ");
}
