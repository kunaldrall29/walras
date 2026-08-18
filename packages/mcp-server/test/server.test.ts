/**
 * search_resources through a REAL MCP client session (linked in-memory
 * transports, actual JSON-RPC) against a fetch double speaking the exact
 * discovery wire shapes of FACTS F-026 … F-028 / F-082.
 */
import { describe, expect, it } from "vitest";

import { mintResourceId } from "../src/id.js";
import {
  fetchDouble,
  httpListing,
  makeDeps,
  mcpListing,
  searchBody,
  session,
} from "./helpers.js";

describe("MCP surface", () => {
  it("exposes exactly search_resources and paid_call, with input schemas", async () => {
    const s = await session(makeDeps());
    try {
      const { tools } = await s.client.listTools();
      const names = tools.map(tool => tool.name).sort();
      expect(names).toEqual(["paid_call", "search_resources"]);
      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
    } finally {
      await s.close();
    }
  });
});

describe("search_resources", () => {
  it("maps listings to deterministic entries (ids, price, F-082 schema locations)", async () => {
    const { impl, calls } = fetchDouble({
      "/discovery/search": () =>
        new Response(searchBody([httpListing(), mcpListing()], "CURSOR1"), { status: 200 }),
    });
    const s = await session(makeDeps({ fetchImpl: impl }));
    try {
      const result = await s.call("search_resources", {
        query: "weather",
        filters: { network: "stellar:testnet", limit: 5 },
      });
      expect(result.isError).toBeUndefined();

      // The dual-format rule: text is the JSON-stringified structuredContent.
      expect(result.content[0]?.text).toBe(JSON.stringify(result.structuredContent));

      const body = result.structuredContent as {
        query: string;
        count: number;
        partialResults: boolean;
        cursor: string | null;
        resources: Array<Record<string, unknown>>;
      };
      expect(body.query).toBe("weather");
      expect(body.count).toBe(2);
      expect(body.partialResults).toBe(true);
      expect(body.cursor).toBe("CURSOR1");

      const [http, mcp] = body.resources;
      expect(http.id).toBe(
        mintResourceId({ type: "http", resource: "http://127.0.0.1:4022/weather", toolName: "" }),
      );
      expect(http.name).toBe("Weather Service");
      expect(http.toolName).toBeNull();
      expect(http.network).toBe("stellar:testnet");
      expect((http.price as { amount: string }).amount).toBe("100000");
      const httpInput = http.input as {
        method: string;
        example: Record<string, unknown>;
        schema: { required?: string[] };
      };
      expect(httpInput.method).toBe("GET");
      expect(httpInput.example).toEqual({ city: "Zurich", units: "metric" });
      expect(httpInput.schema.required).toEqual(["city"]);

      expect(mcp.id).toBe(
        mintResourceId({ type: "mcp", resource: "http://127.0.0.1:4023/mcp", toolName: "hello" }),
      );
      expect(mcp.toolName).toBe("hello");
      const mcpInput = mcp.input as {
        method: null;
        example: Record<string, unknown>;
        schema: { required?: string[] };
      };
      expect(mcpInput.method).toBeNull();
      expect(mcpInput.example).toEqual({ name: "Ada" });
      expect(mcpInput.schema.required).toEqual(["name"]);

      // The double saw the spec parameter names (query, not q — F-026).
      const sent = calls[0].url;
      expect(sent.searchParams.get("query")).toBe("weather");
      expect(sent.searchParams.get("network")).toBe("stellar:testnet");
      expect(sent.searchParams.get("limit")).toBe("5");
    } finally {
      await s.close();
    }
  });

  it("is deterministic: identical calls return identical bytes", async () => {
    const { impl } = fetchDouble({
      "/discovery/search": () => new Response(searchBody([httpListing()]), { status: 200 }),
    });
    const s = await session(makeDeps({ fetchImpl: impl }));
    try {
      const first = await s.call("search_resources", { query: "weather" });
      const second = await s.call("search_resources", { query: "weather" });
      expect(first.content[0]?.text).toBe(second.content[0]?.text);
    } finally {
      await s.close();
    }
  });

  it("passes facilitator error codes through verbatim (D-028 taxonomy 1)", async () => {
    const { impl } = fetchDouble({
      "/discovery/search": () =>
        new Response(
          JSON.stringify({
            error: { code: "walras_invalid_search_cursor", reason: "Cursor mismatch." },
          }),
          { status: 400 },
        ),
    });
    const s = await session(makeDeps({ fetchImpl: impl }));
    try {
      const result = await s.call("search_resources", { query: "x", filters: { cursor: "bad" } });
      expect(result.isError).toBe(true);
      const body = result.structuredContent as { errorCode: string; reason: string };
      expect(body.errorCode).toBe("walras_invalid_search_cursor");
      expect(body.reason).toBe("Cursor mismatch.");
    } finally {
      await s.close();
    }
  });

  it("names an unreachable facilitator", async () => {
    const s = await session(makeDeps()); // default fetchImpl throws
    try {
      const result = await s.call("search_resources", { query: "x" });
      expect(result.isError).toBe(true);
      const body = result.structuredContent as { errorCode: string; reason: string };
      expect(body.errorCode).toBe("walras_mcp_facilitator_unreachable");
      expect(body.reason).toBeTruthy();
    } finally {
      await s.close();
    }
  });

  it("names an error body it cannot attribute to the facilitator", async () => {
    const { impl } = fetchDouble({
      "/discovery/search": () => new Response("<html>proxy error</html>", { status: 502 }),
    });
    const s = await session(makeDeps({ fetchImpl: impl }));
    try {
      const result = await s.call("search_resources", { query: "x" });
      expect(result.isError).toBe(true);
      const body = result.structuredContent as { errorCode: string };
      expect(body.errorCode).toBe("walras_mcp_search_failed");
    } finally {
      await s.close();
    }
  });
});
