import { afterEach, describe, expect, it } from "vitest";
import { BazaarStore } from "@walras/bazaar";
import type { PaymentRequirements } from "@x402/core/types";
import { startHarness, type Harness } from "./helpers/harness.js";

/**
 * `GET /discovery/search` over the HTTP surface: spec shape (FACTS F-026 …
 * F-028), the required-`query` and invalid-cursor rejections, filter
 * pass-through, and an exactly-once cursor walk. The ranking itself is tested
 * in the bazaar package; here the subject is the wire contract.
 */

const SELLER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/**
 * Builds requirements for the seeded listings.
 *
 * @param overrides - Field overrides.
 * @returns Payment requirements.
 */
function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet" as PaymentRequirements["network"],
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    amount: "100000",
    payTo: SELLER,
    maxTimeoutSeconds: 300,
    extra: {},
    ...overrides,
  };
}

/**
 * Builds a store pre-seeded with searchable listings.
 *
 * @returns The seeded in-memory store.
 */
function seededStore(): BazaarStore {
  const store = new BazaarStore(":memory:");
  const entries = [
    {
      resource: "https://api.example.com/weather",
      description: "Current weather conditions for any city right now",
      serviceName: "Demo Weather",
      tags: ["weather", "current"],
    },
    {
      resource: "https://api.example.com/weather/history",
      description: "Historical daily weather for a city on a past date",
      serviceName: "Demo Weather",
      tags: ["weather", "history"],
    },
    {
      resource: "https://api.example.com/air",
      description: "Air quality index for a city with pollutant breakdown",
      serviceName: "Demo Air",
      tags: ["air", "aqi"],
    },
  ];
  for (const entry of entries) {
    store.upsertFromSettlement({
      ...entry,
      type: "http",
      toolName: "",
      payTo: SELLER,
      x402Version: 2,
      extensions: { bazaar: { info: {}, schema: {} } },
      requirements: requirements(),
      settledAt: "2026-08-03T00:00:00.000Z",
    });
  }
  return store;
}

describe("GET /discovery/search", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  it("returns the spec search shape: resources, partialResults, pagination {limit, cursor}", async () => {
    harness = await startHarness({ bazaarStore: seededStore() });

    const response = await harness.app.inject({
      method: "GET",
      url: "/discovery/search?query=current%20weather%20conditions",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.x402Version).toBe(2);
    // Search returns `resources` — never `items` (D-001, F-027).
    expect(body.items).toBeUndefined();
    expect(Array.isArray(body.resources)).toBe(true);
    expect(body.resources[0].resource).toBe("https://api.example.com/weather");
    expect(body.partialResults).toBe(false);
    // pagination.limit is the count in THIS page, not the requested maximum.
    expect(body.pagination).toEqual({ limit: body.resources.length, cursor: null });
  });

  it("rejects a missing or empty query with walras_missing_search_query", async () => {
    harness = await startHarness({ bazaarStore: seededStore() });

    for (const url of ["/discovery/search", "/discovery/search?query=", "/discovery/search?query=%20"]) {
      const response = await harness.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("walras_missing_search_query");
      expect(body.error.reason).toBeTruthy();
    }
  });

  it("rejects repeated parameters and non-numeric limits with walras_invalid_query_parameter", async () => {
    harness = await startHarness({ bazaarStore: seededStore() });

    for (const url of [
      "/discovery/search?query=weather&query=air",
      "/discovery/search?query=weather&limit=abc",
    ]) {
      const response = await harness.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("walras_invalid_query_parameter");
    }
  });

  it("walks the full result set exactly once via cursors, flagging truncation honestly", async () => {
    harness = await startHarness({ bazaarStore: seededStore() });

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url =
        "/discovery/search?query=weather%20city%20air&limit=1" +
        (cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`);
      const response = await harness.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        resources: Array<{ resource: string }>;
        partialResults: boolean;
        pagination: { limit: number; cursor: string | null };
      };
      expect(body.resources).toHaveLength(1);
      expect(body.pagination.limit).toBe(1);
      seen.push(body.resources[0]!.resource);
      cursor = body.pagination.cursor;
      // partialResults is true exactly while matches remain truncated (F-028).
      expect(body.partialResults).toBe(cursor !== null);
      pages += 1;
      expect(pages).toBeLessThan(10);
    } while (cursor !== null);

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("rejects a foreign or malformed cursor with walras_invalid_search_cursor", async () => {
    harness = await startHarness({ bazaarStore: seededStore() });

    const first = await harness.app.inject({
      method: "GET",
      url: "/discovery/search?query=weather%20city%20air&limit=1",
    });
    const cursor = first.json().pagination.cursor as string;
    expect(cursor).toBeTruthy();

    for (const url of [
      `/discovery/search?query=DIFFERENT&cursor=${encodeURIComponent(cursor)}`,
      "/discovery/search?query=weather&cursor=garbage!!",
    ]) {
      const response = await harness.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("walras_invalid_search_cursor");
      expect(body.error.reason).toBeTruthy();
    }
  });

  it("applies the discovery filters to search results", async () => {
    harness = await startHarness({ bazaarStore: seededStore() });

    const filtered = await harness.app.inject({
      method: "GET",
      url: `/discovery/search?query=weather&payTo=${SELLER}&scheme=exact&network=stellar:testnet&type=http&extensions=bazaar`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().resources.length).toBeGreaterThan(0);

    const excluded = await harness.app.inject({
      method: "GET",
      url: "/discovery/search?query=weather&network=eip155:8453",
    });
    expect(excluded.statusCode).toBe(200);
    const body = excluded.json();
    expect(body.resources).toEqual([]);
    expect(body.partialResults).toBe(false);
    expect(body.pagination).toEqual({ limit: 0, cursor: null });
  });
});
