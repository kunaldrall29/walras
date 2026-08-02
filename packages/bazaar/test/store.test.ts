import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  BazaarStore,
  clampLimit,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MIN_LIST_LIMIT,
  type UpsertInput,
} from "../src/store.js";
import { makeRequirements, SELLER_A, SELLER_B, T0, T1 } from "./helpers.js";

/**
 * Builds a minimal valid upsert input.
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

describe("BazaarStore", () => {
  describe("engine", () => {
    it("runs a file-backed database in WAL journal mode", () => {
      const dir = mkdtempSync(join(tmpdir(), "walras-bazaar-"));
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
      const path = join(dir, "nested", "catalog.db");

      const store = new BazaarStore(path);
      cleanups.push(() => store.close());

      // Independent connection so the assertion reads SQLite's own view of
      // the file, not the writing connection's session state.
      const probe = new DatabaseSync(path);
      cleanups.push(() => probe.close());
      const row = probe.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(row.journal_mode).toBe("wal");
    });
  });

  describe("tuple keying (FACTS F-029)", () => {
    it("keeps an HTTP resource and two MCP tools at the same URL as three distinct listings", () => {
      const store = memStore();
      const url = "https://api.example.com/mcp";

      store.upsertFromSettlement(input({ resource: url, type: "http" }));
      store.upsertFromSettlement(input({ resource: url, type: "mcp", toolName: "tool_a" }));
      store.upsertFromSettlement(input({ resource: url, type: "mcp", toolName: "tool_b" }));

      expect(store.count()).toBe(3);
      expect(store.getListing(url, "http", "")?.type).toBe("http");
      expect(store.getListing(url, "mcp", "tool_a")?.toolName).toBe("tool_a");
      expect(store.getListing(url, "mcp", "tool_b")?.toolName).toBe("tool_b");
    });
  });

  describe("upsert lifecycle", () => {
    it("round-trips every stored field", () => {
      const store = memStore();
      store.upsertFromSettlement(
        input({
          mimeType: "application/json",
          serviceName: "Example Weather",
          tags: ["weather", "forecast"],
          iconUrl: "https://api.example.com/icon.png",
        }),
      );

      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing).toMatchObject({
        resource: "https://api.example.com/weather",
        type: "http",
        toolName: "",
        ownerPayTo: SELLER_A,
        x402Version: 2,
        description: "Weather data endpoint",
        mimeType: "application/json",
        serviceName: "Example Weather",
        tags: ["weather", "forecast"],
        iconUrl: "https://api.example.com/icon.png",
        firstSettledAt: T0,
        lastSettledAt: T0,
        settleCount: 1,
      });
      expect(listing?.accepts).toEqual([makeRequirements()]);
    });

    it("refreshes metadata and bumps settleCount on a same-owner resettle, deduping identical accepts", () => {
      const store = memStore();
      store.upsertFromSettlement(input());
      const result = store.upsertFromSettlement(
        input({ description: "Updated description", settledAt: T1 }),
      );

      expect(result).toEqual({ outcome: "updated" });
      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing?.description).toBe("Updated description");
      expect(listing?.firstSettledAt).toBe(T0);
      expect(listing?.lastSettledAt).toBe(T1);
      expect(listing?.settleCount).toBe(2);
      expect(listing?.accepts).toHaveLength(1);
    });

    it("accumulates a second accepts entry when the settled price changes", () => {
      const store = memStore();
      store.upsertFromSettlement(input());
      store.upsertFromSettlement(
        input({ requirements: makeRequirements({ amount: "200000" }), settledAt: T1 }),
      );

      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing?.accepts.map(a => a.amount)).toEqual(["100000", "200000"]);
    });
  });

  describe("ownership (DECISIONS D-024)", () => {
    it("rejects a different payTo for an existing listing and writes nothing", () => {
      const store = memStore();
      store.upsertFromSettlement(input());

      const result = store.upsertFromSettlement(
        input({
          payTo: SELLER_B,
          description: "POISONED",
          requirements: makeRequirements({ payTo: SELLER_B }),
          settledAt: T1,
        }),
      );

      expect(result).toEqual({ outcome: "ownership_conflict", ownerPayTo: SELLER_A });
      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing?.ownerPayTo).toBe(SELLER_A);
      expect(listing?.description).toBe("Weather data endpoint");
      expect(listing?.lastSettledAt).toBe(T0);
      expect(listing?.settleCount).toBe(1);
      expect(listing?.accepts.every(a => a.payTo === SELLER_A)).toBe(true);
    });
  });

  describe("list filters (FACTS F-025)", () => {
    /**
     * Seeds three listings that differ across every filterable axis.
     *
     * @param store - The store to seed.
     */
    function seed(store: BazaarStore): void {
      store.upsertFromSettlement(
        input({
          resource: "https://a.example.com/one",
          extensions: { bazaar: {} },
        }),
      );
      store.upsertFromSettlement(
        input({
          resource: "https://b.example.com/mcp",
          type: "mcp",
          toolName: "tool_x",
          payTo: SELLER_B,
          requirements: makeRequirements({ payTo: SELLER_B }),
          extensions: { bazaar: {}, "sign-in-with-x": {} },
        }),
      );
      store.upsertFromSettlement(
        input({
          resource: "https://c.example.com/two",
          requirements: makeRequirements({ scheme: "other-scheme" }),
          extensions: { bazaar: {} },
        }),
      );
    }

    it("filters by type", () => {
      const store = memStore();
      seed(store);
      const page = store.list({ type: "mcp" });
      expect(page.items.map(i => i.resource)).toEqual(["https://b.example.com/mcp"]);
      expect(page.total).toBe(1);
    });

    it("filters by payTo", () => {
      const store = memStore();
      seed(store);
      const page = store.list({ payTo: SELLER_B });
      expect(page.items.map(i => i.resource)).toEqual(["https://b.example.com/mcp"]);
    });

    it("filters by scheme", () => {
      const store = memStore();
      seed(store);
      const page = store.list({ scheme: "other-scheme" });
      expect(page.items.map(i => i.resource)).toEqual(["https://c.example.com/two"]);
    });

    it("filters by network", () => {
      const store = memStore();
      seed(store);
      expect(store.list({ network: "stellar:testnet" }).total).toBe(3);
      expect(store.list({ network: "stellar:pubnet" }).total).toBe(0);
    });

    it("filters by extension key", () => {
      const store = memStore();
      seed(store);
      const page = store.list({ extensions: "sign-in-with-x" });
      expect(page.items.map(i => i.resource)).toEqual(["https://b.example.com/mcp"]);
      expect(store.list({ extensions: "bazaar" }).total).toBe(3);
    });

    it("requires accepts-level filters to match within one payment option", () => {
      const store = memStore();
      seed(store);
      // SELLER_B accepts only on stellar:testnet; a cross-option combination
      // of a real payTo with a scheme it never settled must not match.
      expect(store.list({ payTo: SELLER_B, scheme: "other-scheme" }).total).toBe(0);
      expect(store.list({ payTo: SELLER_B, scheme: "exact", network: "stellar:testnet" }).total).toBe(1);
    });
  });

  describe("ordering and pagination", () => {
    it("orders deterministically by resource then toolName regardless of insertion order", () => {
      const store = memStore();
      store.upsertFromSettlement(input({ resource: "https://z.example.com/late" }));
      store.upsertFromSettlement(input({ resource: "https://a.example.com/early" }));
      store.upsertFromSettlement(
        input({ resource: "https://m.example.com/mcp", type: "mcp", toolName: "beta" }),
      );
      store.upsertFromSettlement(
        input({ resource: "https://m.example.com/mcp", type: "mcp", toolName: "alpha" }),
      );

      const page = store.list();
      expect(page.items.map(i => `${i.resource}#${i.toolName}`)).toEqual([
        "https://a.example.com/early#",
        "https://m.example.com/mcp#alpha",
        "https://m.example.com/mcp#beta",
        "https://z.example.com/late#",
      ]);
    });

    it("pages with limit/offset and reports the unfiltered-match total", () => {
      const store = memStore();
      for (let i = 0; i < 5; i++) {
        store.upsertFromSettlement(input({ resource: `https://example.com/r${i}` }));
      }

      const page = store.list({ limit: 2, offset: 2 });
      expect(page.items.map(i => i.resource)).toEqual([
        "https://example.com/r2",
        "https://example.com/r3",
      ]);
      expect(page).toMatchObject({ limit: 2, offset: 2, total: 5 });
    });

    it("clamps limit to the spec range with the spec default", () => {
      expect(clampLimit(undefined)).toBe(DEFAULT_LIST_LIMIT);
      expect(clampLimit(0)).toBe(MIN_LIST_LIMIT);
      expect(clampLimit(-5)).toBe(MIN_LIST_LIMIT);
      expect(clampLimit(101)).toBe(MAX_LIST_LIMIT);
      expect(clampLimit(1000)).toBe(MAX_LIST_LIMIT);
      expect(clampLimit(37)).toBe(37);
    });
  });
});
