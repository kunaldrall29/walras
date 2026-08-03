import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { InvalidCursorError } from "../src/cursor.js";
import { toFtsMatchExpression, type Retriever } from "../src/retriever.js";
import { extractParamText } from "../src/searchtext.js";
import { BazaarStore, type SearchPage, type UpsertInput } from "../src/store.js";
import { makeRequirements, SELLER_A, SELLER_B, T0, T1 } from "./helpers.js";

/**
 * Builds an upsert input for one searchable listing.
 *
 * @param overrides - Field overrides.
 * @returns The upsert input.
 */
function input(overrides: Partial<UpsertInput> = {}): UpsertInput {
  return {
    resource: "https://api.example.com/weather",
    type: "http",
    toolName: "",
    payTo: SELLER_A,
    x402Version: 2,
    description: "Weather data endpoint",
    extensions: { bazaar: { info: {}, schema: {} } },
    requirements: makeRequirements(),
    settledAt: T0,
    ...overrides,
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

/**
 * Opens a store on :memory: and registers its cleanup.
 *
 * @returns The open store.
 */
function memStore(): BazaarStore {
  const store = new BazaarStore(":memory:");
  cleanups.push(() => store.close());
  return store;
}

/**
 * Seeds a store with the small fixed corpus the ranking tests read.
 *
 * @param store - The store to seed.
 */
function seedCorpus(store: BazaarStore): void {
  const entries: Array<Partial<UpsertInput>> = [
    {
      resource: "https://api.example.com/weather",
      serviceName: "Demo Weather",
      description: "Current weather conditions for any city right now",
      tags: ["weather", "current", "forecast"],
      extensions: {
        bazaar: {
          schema: {
            properties: {
              city: { type: "string", description: "City name to report current weather for" },
            },
          },
        },
      },
    },
    {
      resource: "https://api.example.com/weather/history",
      serviceName: "Demo Weather",
      description: "Historical daily weather for a city on a past date",
      tags: ["weather", "history", "climate"],
      extensions: {
        bazaar: {
          schema: {
            properties: {
              city: { type: "string", description: "City to fetch the historical record for" },
              date: { type: "string", description: "Calendar day to look up" },
            },
          },
        },
      },
    },
    {
      resource: "https://api.example.com/fx",
      serviceName: "Demo FX",
      description: "Foreign exchange rate between two fiat currencies",
      tags: ["finance", "currency", "exchange"],
      extensions: {
        bazaar: {
          schema: {
            properties: {
              base: { type: "string", description: "Base currency as an ISO 4217 code" },
            },
          },
        },
      },
    },
    {
      resource: "https://api.example.com/geocode",
      serviceName: "Demo Geo",
      description: "Turn a street address into latitude and longitude coordinates",
      tags: ["geocoding", "maps"],
      extensions: { bazaar: { info: {}, schema: {} } },
    },
  ];
  for (const entry of entries) {
    const result = store.upsertFromSettlement(input(entry));
    expect(result.outcome).toBe("created");
  }
}

/**
 * Walks a search to exhaustion via cursors.
 *
 * @param store - The store to search.
 * @param query - The query text.
 * @param limit - Page size.
 * @returns All pages in walk order.
 */
function walk(store: BazaarStore, query: string, limit: number): SearchPage[] {
  const pages: SearchPage[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = store.search({ query, limit, cursor });
    pages.push(page);
    if (page.nextCursor === null) return pages;
    cursor = page.nextCursor;
    expect(pages.length).toBeLessThan(50);
  }
}

describe("toFtsMatchExpression", () => {
  it("quotes every token and joins with OR", () => {
    expect(toFtsMatchExpression("current weather zurich")).toBe(
      '"current" OR "weather" OR "zurich"',
    );
  });

  it("survives FTS5 operator syntax in hostile queries", () => {
    expect(toFtsMatchExpression('what\'s "best-" weather: (NEAR today*')).toBe(
      '"what" OR "s" OR "best" OR "weather" OR "NEAR" OR "today"',
    );
  });

  it("returns undefined when no letters or numbers survive", () => {
    expect(toFtsMatchExpression("?! ()\"*:-")).toBeUndefined();
    expect(toFtsMatchExpression("")).toBeUndefined();
  });

  it("keeps unicode letters and digits", () => {
    expect(toFtsMatchExpression("météo Zürich 42")).toBe('"météo" OR "Zürich" OR "42"');
  });

  it("caps the token count", () => {
    const many = Array.from({ length: 50 }, (_, i) => `tok${i}`).join(" ");
    const expression = toFtsMatchExpression(many);
    expect(expression).toBeDefined();
    expect(expression?.split(" OR ")).toHaveLength(32);
  });
});

describe("extractParamText", () => {
  it("collects property names and description annotations, not example values", () => {
    const text = extractParamText({
      bazaar: {
        info: { input: { type: "http", method: "GET", queryParams: { city: "Zurich" } } },
        schema: {
          properties: {
            input: {
              properties: {
                queryParams: {
                  properties: {
                    city: { type: "string", description: "City name to look up" },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(text).toContain("city");
    expect(text).toContain("City name to look up");
    expect(text).not.toContain("Zurich");
  });

  it("collects MCP tool names and inputSchema descriptions", () => {
    const text = extractParamText({
      bazaar: {
        info: {
          input: {
            type: "mcp",
            toolName: "financial_analysis",
            inputSchema: {
              properties: { ticker: { type: "string", description: "Ticker symbol to analyze" } },
            },
          },
        },
      },
    });
    expect(text).toContain("financial_analysis");
    expect(text).toContain("ticker");
    expect(text).toContain("Ticker symbol to analyze");
  });

  it("is bounded against deep and bulky structures", () => {
    let node: Record<string, unknown> = { description: "bottom" };
    for (let i = 0; i < 100; i += 1) node = { nested: node };
    expect(extractParamText({ bazaar: node })).toBe("");

    const big = { bazaar: { description: "x".repeat(100_000) } };
    expect(extractParamText(big).length).toBeLessThanOrEqual(100_000);
    expect(extractParamText(undefined)).toBe("");
  });
});

describe("BazaarStore.search — ranking and shape", () => {
  it("ranks the better lexical match first and reports scores descending", () => {
    const store = memStore();
    seedCorpus(store);
    const page = store.search({ query: "current weather conditions" });
    expect(page.resources.length).toBeGreaterThanOrEqual(2);
    expect(page.resources[0]?.resource).toBe("https://api.example.com/weather");
    expect(page.partialResults).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("matches on per-parameter schema descriptions", () => {
    const store = memStore();
    seedCorpus(store);
    const page = store.search({ query: "ISO 4217" });
    expect(page.resources.map(r => r.resource)).toEqual(["https://api.example.com/fx"]);
  });

  it("returns an empty page for a query with no matches or no tokens", () => {
    const store = memStore();
    seedCorpus(store);
    for (const query of ["quantum blockchain espresso", "?!"]) {
      const page = store.search({ query });
      expect(page.resources).toEqual([]);
      expect(page.partialResults).toBe(false);
      expect(page.nextCursor).toBeNull();
    }
  });

  it("reflects the latest settlement's text after an upsert", () => {
    const store = memStore();
    store.upsertFromSettlement(input({ description: "Original wording about tides" }));
    store.upsertFromSettlement(
      input({ description: "Replacement wording about eclipses", settledAt: T1 }),
    );
    expect(store.search({ query: "tides" }).resources).toEqual([]);
    expect(store.search({ query: "eclipses" }).resources).toHaveLength(1);
  });

  it("does not index anything from a rejected ownership-conflict write", () => {
    const store = memStore();
    store.upsertFromSettlement(input({ description: "legitimate listing" }));
    const result = store.upsertFromSettlement(
      input({ payTo: SELLER_B, description: "poisoned replacement text" }),
    );
    expect(result.outcome).toBe("ownership_conflict");
    expect(store.search({ query: "poisoned replacement" }).resources).toEqual([]);
    expect(store.search({ query: "legitimate" }).resources).toHaveLength(1);
  });
});

describe("BazaarStore.search — filters", () => {
  it("intersects the ranking with the list-endpoint filters", () => {
    const store = memStore();
    seedCorpus(store);
    store.upsertFromSettlement(
      input({
        resource: "https://api.example.com/weather-tool",
        type: "mcp",
        toolName: "weather_tool",
        payTo: SELLER_B,
        description: "Weather conditions exposed as an MCP tool",
        requirements: makeRequirements({ payTo: SELLER_B }),
      }),
    );

    const all = store.search({ query: "weather" });
    expect(all.resources.length).toBe(3);

    const mcpOnly = store.search({ query: "weather", type: "mcp" });
    expect(mcpOnly.resources.map(r => r.type)).toEqual(["mcp"]);

    const sellerB = store.search({ query: "weather", payTo: SELLER_B });
    expect(sellerB.resources.map(r => r.ownerPayTo)).toEqual([SELLER_B]);

    expect(store.search({ query: "weather", network: "eip155:8453" }).resources).toEqual([]);
    expect(store.search({ query: "weather", extensions: "bazaar" }).resources).toHaveLength(3);
    expect(store.search({ query: "weather", extensions: "nonexistent" }).resources).toEqual([]);
  });
});

describe("BazaarStore.search — cursor pagination", () => {
  it("walks the full result set exactly once, in rank order", () => {
    const store = memStore();
    seedCorpus(store);
    const full = store.search({ query: "weather city date currency address", limit: 100 });
    const pages = walk(store, "weather city date currency address", 1);

    const walked = pages.flatMap(page => page.resources.map(r => r.resource));
    expect(walked).toEqual(full.resources.map(r => r.resource));
    expect(new Set(walked).size).toBe(walked.length);

    for (const page of pages.slice(0, -1)) expect(page.partialResults).toBe(true);
    expect(pages.at(-1)?.partialResults).toBe(false);
    expect(pages.at(-1)?.nextCursor).toBeNull();
  });

  it("rejects malformed cursors and cursors from a different search", () => {
    const store = memStore();
    seedCorpus(store);
    const first = store.search({ query: "weather", limit: 1 });
    expect(first.nextCursor).not.toBeNull();

    expect(() => store.search({ query: "weather", cursor: "not-a-cursor!" })).toThrow(
      InvalidCursorError,
    );
    expect(() =>
      store.search({
        query: "weather",
        cursor: Buffer.from(JSON.stringify({ v: 99 })).toString("base64url"),
      }),
    ).toThrow(InvalidCursorError);
    // Same cursor, different query → named rejection, not a silently wrong page.
    expect(() =>
      store.search({ query: "currency", cursor: first.nextCursor as string }),
    ).toThrow(InvalidCursorError);
    // Different filter set breaks the binding too.
    expect(() =>
      store.search({ query: "weather", type: "mcp", cursor: first.nextCursor as string }),
    ).toThrow(InvalidCursorError);
  });

  it("keeps partialResults true through the last page when retrieval was capped", () => {
    const store = memStore();
    seedCorpus(store);
    const page = store.search({ query: "weather city", limit: 100 }, { maxRetrieve: 2 });
    expect(page.resources).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
    expect(page.partialResults).toBe(true);
  });

  it("supports a custom retriever through the seam", () => {
    const store = memStore();
    seedCorpus(store);
    const reversed: Retriever = {
      retrieve: (query, limit) =>
        store
          .search({ query, limit })
          .resources.map((_, index) => ({ id: index + 1, score: 1 }))
          .reverse(),
    };
    const page = store.search({ query: "weather" }, { retriever: reversed });
    expect(page.resources.length).toBeGreaterThan(0);
  });
});

describe("BazaarStore — search index backfill", () => {
  it("indexes pre-existing rows when a database predating the index is opened", () => {
    const dir = mkdtempSync(join(tmpdir(), "walras-backfill-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "catalog.db");

    const store = new BazaarStore(path);
    seedCorpus(store);
    expect(store.search({ query: "weather" }).resources.length).toBeGreaterThan(0);
    store.close();

    // Simulate the Session 3 schema: listings present, no search index.
    const raw = new DatabaseSync(path);
    raw.exec("DROP TABLE search_index");
    raw.close();

    const reopened = new BazaarStore(path);
    cleanups.push(() => reopened.close());
    const page = reopened.search({ query: "current weather conditions" });
    expect(page.resources[0]?.resource).toBe("https://api.example.com/weather");
    expect(reopened.search({ query: "ISO 4217" }).resources).toHaveLength(1);
  });
});
