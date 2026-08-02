import { afterEach, describe, expect, it } from "vitest";
import { BazaarStore } from "@walras/bazaar";
import type { PaymentPayload } from "@x402/core/types";
import { fixtures, requestBody, startHarness, type Harness } from "./helpers/harness.js";

/**
 * The settle-time cataloging hook and `GET /discovery/resources`, end to end
 * over the HTTP surface.
 *
 * Settlements here are **modelled** through the Soroban RPC double (DECISIONS
 * D-017) — but everything these tests assert about is real: the indexer runs
 * against the real store, the header is the real wire value, and the catalog
 * is read back through the real endpoint. The live counterpart is EVIDENCE
 * S3-*.
 */

/**
 * A valid GET-endpoint bazaar extension, per the spec's own example.
 *
 * @returns The extension object.
 */
function getExtension(): Record<string, unknown> {
  return {
    info: {
      input: { type: "http", method: "GET", queryParams: { city: "San Francisco" } },
      output: { type: "json", example: { weather: "foggy" } },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: {
            type: { type: "string", const: "http" },
            method: { type: "string", enum: ["GET", "HEAD", "DELETE"] },
            queryParams: {
              type: "object",
              properties: { city: { type: "string", description: "City to query" } },
              required: ["city"],
            },
          },
          required: ["type", "method"],
          additionalProperties: false,
        },
        output: {
          type: "object",
          properties: { type: { type: "string" } },
          required: ["type"],
        },
      },
      required: ["input"],
    },
  };
}

/**
 * The fixture's valid settle payload, enriched with a resource block and a
 * bazaar extension exactly as a stock client would echo them (F-032).
 *
 * @param extension - The bazaar extension to attach.
 * @returns The enriched payment payload.
 */
function payloadWithBazaar(extension: unknown): PaymentPayload {
  return {
    ...fixtures.cases.valid!.payload,
    resource: {
      url: "https://api.example.com/weather?city=SF",
      description: "Weather data endpoint",
      serviceName: "Example Weather",
      tags: ["weather", "forecast"],
    },
    extensions: { bazaar: extension },
  } as PaymentPayload;
}

/**
 * Decodes an EXTENSION-RESPONSES header value.
 *
 * @param header - The base64 header value.
 * @returns The decoded object.
 */
function decodeHeader(header: string): { bazaar: Record<string, unknown> } {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as {
    bazaar: Record<string, unknown>;
  };
}

describe("settle-time cataloging", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  it("catalogs a settled payment and reports success in EXTENSION-RESPONSES, with no registration step", async () => {
    harness = await startHarness();

    const settle = await harness.app.inject({
      method: "POST",
      url: "/settle",
      payload: requestBody(payloadWithBazaar(getExtension())),
    });

    expect(settle.statusCode).toBe(200);
    expect(settle.json().success).toBe(true);
    const header = settle.headers["extension-responses"];
    expect(header).toBeDefined();
    expect(decodeHeader(header as string)).toEqual({ bazaar: { status: "success" } });

    // The resource is browsable immediately — settlement WAS the registration.
    const list = await harness.app.inject({ method: "GET", url: "/discovery/resources" });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      // Query string stripped by canonicalization (F-051 semantics).
      resource: "https://api.example.com/weather",
      type: "http",
      x402Version: 2,
      serviceName: "Example Weather",
      tags: ["weather", "forecast"],
    });
    // The accepts entry is the verified requirements of the settled payment —
    // the payTo binding a browsing agent gets to see.
    expect(body.items[0].accepts).toEqual([fixtures.requirements]);
    expect(typeof body.items[0].lastUpdated).toBe("string");
  });

  it("soft-drops a hostile extension with a machine-readable reason while the settlement still succeeds", async () => {
    harness = await startHarness();

    // The trivial-schema attack: client-authored schema validates anything.
    const settle = await harness.app.inject({
      method: "POST",
      url: "/settle",
      payload: requestBody(
        payloadWithBazaar({ info: { input: { type: "garbage" } }, schema: { type: "object" } }),
      ),
    });

    expect(settle.statusCode).toBe(200);
    expect(settle.json().success).toBe(true);
    expect(settle.json().transaction).toMatch(/^[0-9a-f]{64}$/);

    const decoded = decodeHeader(settle.headers["extension-responses"] as string);
    expect(decoded.bazaar.status).toBe("rejected");
    expect(decoded.bazaar.code).toBe("bazaar_spec_validation_failed");
    expect(decoded.bazaar.rejectedReason).toBeTruthy();

    const list = await harness.app.inject({ method: "GET", url: "/discovery/resources" });
    expect(list.json().items).toEqual([]);
  });

  it("sends no header when the payload carries no bazaar extension (F-032)", async () => {
    harness = await startHarness();

    const settle = await harness.app.inject({
      method: "POST",
      url: "/settle",
      payload: requestBody(fixtures.cases.valid!.payload),
    });

    expect(settle.json().success).toBe(true);
    expect(settle.headers["extension-responses"]).toBeUndefined();
  });

  it("does not catalog a payment that fails to settle", async () => {
    harness = await startHarness();

    const settle = await harness.app.inject({
      method: "POST",
      url: "/settle",
      payload: requestBody({
        ...payloadWithBazaar(getExtension()),
        ...fixtures.cases.wrongAmount!.payload,
        resource: { url: "https://api.example.com/weather" },
        extensions: { bazaar: getExtension() },
      } as PaymentPayload),
    });

    expect(settle.json().success).toBe(false);
    expect(settle.headers["extension-responses"]).toBeUndefined();
    const list = await harness.app.inject({ method: "GET", url: "/discovery/resources" });
    expect(list.json().items).toEqual([]);
  });

  it("settles successfully with no header when the catalog store is broken (DECISIONS D-015)", async () => {
    const broken = new BazaarStore(":memory:");
    broken.close(); // every statement now throws
    harness = await startHarness({ bazaarStore: broken });

    const settle = await harness.app.inject({
      method: "POST",
      url: "/settle",
      payload: requestBody(payloadWithBazaar(getExtension())),
    });

    // The invariant: a dead indexer degrades discovery, never payments — and
    // a walras fault is never misreported as a client rejection.
    expect(settle.statusCode).toBe(200);
    expect(settle.json().success).toBe(true);
    expect(settle.json().transaction).toMatch(/^[0-9a-f]{64}$/);
    expect(settle.headers["extension-responses"]).toBeUndefined();
  });

  it("rejects a settled payment that targets a listing owned by a different payTo (poisoning, D-024)", async () => {
    // Seed the catalog with the same canonical URL under another seller.
    const store = new BazaarStore(":memory:");
    store.upsertFromSettlement({
      resource: "https://api.example.com/weather",
      type: "http",
      toolName: "",
      payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      x402Version: 2,
      description: "The rightful owner's listing",
      requirements: { ...fixtures.requirements, payTo: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
      settledAt: "2026-08-02T00:00:00.000Z",
    });
    harness = await startHarness({ bazaarStore: store });

    const settle = await harness.app.inject({
      method: "POST",
      url: "/settle",
      payload: requestBody(payloadWithBazaar(getExtension())),
    });

    expect(settle.json().success).toBe(true);
    const decoded = decodeHeader(settle.headers["extension-responses"] as string);
    expect(decoded.bazaar.status).toBe("rejected");
    expect(decoded.bazaar.code).toBe("bazaar_listing_owned_by_other_payee");

    // The original listing is untouched.
    const list = await harness.app.inject({ method: "GET", url: "/discovery/resources" });
    expect(list.json().items[0].description).toBe("The rightful owner's listing");
  });
});

describe("GET /discovery/resources", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  it("returns the spec shape on an empty catalog", async () => {
    harness = await startHarness();

    const response = await harness.app.inject({ method: "GET", url: "/discovery/resources" });

    expect(response.statusCode).toBe(200);
    // D-001: list responses use `items`; F-025 defaults: limit 20, offset 0.
    expect(response.json()).toEqual({
      x402Version: 2,
      items: [],
      pagination: { limit: 20, offset: 0, total: 0 },
    });
  });

  it("applies the seven filters and paginates with a stable order", async () => {
    const store = new BazaarStore(":memory:");
    for (let i = 0; i < 3; i++) {
      store.upsertFromSettlement({
        resource: `https://example.com/r${i}`,
        type: i === 2 ? "mcp" : "http",
        toolName: i === 2 ? "tool" : "",
        payTo: fixtures.requirements.payTo,
        x402Version: 2,
        extensions: { bazaar: {} },
        requirements: fixtures.requirements,
        settledAt: "2026-08-02T00:00:00.000Z",
      });
    }
    harness = await startHarness({ bazaarStore: store });

    const filtered = await harness.app.inject({
      method: "GET",
      url:
        "/discovery/resources?type=http&scheme=exact&network=stellar:testnet" +
        `&payTo=${fixtures.requirements.payTo}&extensions=bazaar&limit=1&offset=1`,
    });

    const body = filtered.json();
    expect(body.items.map((i: { resource: string }) => i.resource)).toEqual([
      "https://example.com/r1",
    ]);
    expect(body.pagination).toEqual({ limit: 1, offset: 1, total: 2 });
  });

  it("clamps an out-of-range limit to the spec bounds (F-025)", async () => {
    harness = await startHarness();

    const response = await harness.app.inject({
      method: "GET",
      url: "/discovery/resources?limit=1000",
    });

    expect(response.json().pagination.limit).toBe(100);
  });

  it("rejects a non-numeric limit with a named 400", async () => {
    harness = await startHarness();

    const response = await harness.app.inject({
      method: "GET",
      url: "/discovery/resources?limit=lots",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("walras_invalid_query_parameter");
    expect(response.json().error.reason).toBeTruthy();
  });

  it("rejects a repeated filter parameter with a named 400", async () => {
    harness = await startHarness();

    const response = await harness.app.inject({
      method: "GET",
      url: "/discovery/resources?type=http&type=mcp",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("walras_invalid_query_parameter");
  });
});
