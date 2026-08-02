import { afterEach, describe, expect, it } from "vitest";
import { indexSettledPayment, MAX_EXTENSIONS_BYTES } from "../src/indexer.js";
import { BazaarStore } from "../src/store.js";
import { encodeExtensionResponses } from "../src/wire.js";
import {
  makeGetExtension,
  makeMcpExtension,
  makePayload,
  makeRequirements,
  SELLER_A,
  SELLER_B,
  T0,
  T1,
} from "./helpers.js";

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

describe("indexSettledPayment", () => {
  describe("happy paths", () => {
    it("indexes a spec-example GET extension under the query-stripped canonical URL", () => {
      const store = memStore();
      const payload = makePayload({
        resource: {
          url: "https://api.example.com/weather?city=SF#frag",
          description: "Weather data endpoint",
        },
      });

      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);

      expect(outcome).toMatchObject({
        status: "indexed",
        resource: "https://api.example.com/weather",
        type: "http",
        toolName: "",
        upsert: "created",
      });
      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing?.ownerPayTo).toBe(SELLER_A);
      expect(listing?.extensions).toHaveProperty("bazaar");
      // The stored extension carries the schemas and per-parameter
      // descriptions the catalog serves back to browsing agents.
      expect(
        JSON.stringify(listing?.extensions),
      ).toContain("City name to query");
    });

    it("indexes an MCP extension keyed on (url, toolName)", () => {
      const store = memStore();
      const payload = makePayload({
        resource: { url: "https://api.example.com/mcp" },
        extensions: { bazaar: makeMcpExtension("financial_analysis") },
      });

      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);

      expect(outcome).toMatchObject({
        status: "indexed",
        type: "mcp",
        toolName: "financial_analysis",
      });
      expect(
        store.getListing("https://api.example.com/mcp", "mcp", "financial_analysis"),
      ).toBeDefined();
    });

    it("uses a valid routeTemplate as the canonical catalog path (F-030)", () => {
      const store = memStore();
      const extension = { ...makeGetExtension(), routeTemplate: "/users/:userId" };
      const payload = makePayload({
        resource: { url: "https://api.example.com/users/123" },
        extensions: { bazaar: extension },
      });

      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);

      expect(outcome).toMatchObject({
        status: "indexed",
        resource: "https://api.example.com/users/:userId",
      });
    });
  });

  describe("skips (no header on the wire)", () => {
    it.each([
      ["no extensions object", makePayload({ extensions: undefined })],
      ["extensions without a bazaar key", makePayload({ extensions: { other: {} } })],
    ])("skips a payload with %s", (_name, payload) => {
      const store = memStore();
      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);
      expect(outcome).toEqual({ status: "skipped", why: "no_extension" });
      expect(store.count()).toBe(0);
      expect(encodeExtensionResponses(outcome)).toBeUndefined();
    });

    it("skips a non-v2 payload (bazaar.md: facilitators are not expected to support v1)", () => {
      const store = memStore();
      const outcome = indexSettledPayment(
        store,
        makePayload({ x402Version: 1 }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toEqual({ status: "skipped", why: "not_v2" });
      expect(store.count()).toBe(0);
    });
  });

  describe("hostile extension payloads (trust boundary)", () => {
    it("rejects a non-object bazaar extension", () => {
      const store = memStore();
      const outcome = indexSettledPayment(
        store,
        makePayload({ extensions: { bazaar: "not-an-object" } }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_extension_not_object" });
      expect(store.count()).toBe(0);
    });

    it("rejects an oversized extensions object before any schema work", () => {
      const store = memStore();
      const outcome = indexSettledPayment(
        store,
        makePayload({
          extensions: { bazaar: { info: {}, schema: {}, pad: "x".repeat(MAX_EXTENSIONS_BYTES) } },
        }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_extensions_too_large" });
      expect(store.count()).toBe(0);
    });

    it("rejects the trivial-schema attack: a client-authored schema cannot relax protocol invariants (F-072)", () => {
      const store = memStore();
      // The client controls BOTH info and schema, so it submits a schema that
      // validates anything and garbage info. Ajv passes; the protocol
      // invariant check must still reject it.
      const outcome = indexSettledPayment(
        store,
        makePayload({
          extensions: {
            bazaar: { info: { input: { type: "garbage" } }, schema: { type: "object" } },
          },
        }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_spec_validation_failed" });
      expect(store.count()).toBe(0);
    });

    it("rejects an MCP extension whose schema is fine but which lacks toolName/inputSchema", () => {
      const store = memStore();
      const outcome = indexSettledPayment(
        store,
        makePayload({
          extensions: {
            bazaar: { info: { input: { type: "mcp" } }, schema: { type: "object" } },
          },
        }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_spec_validation_failed" });
    });

    it("rejects info that fails the extension's own schema (the spec MUST, F-024)", () => {
      const store = memStore();
      const extension = makeGetExtension();
      // Break the info against its own schema: method outside the enum.
      (extension.info as { input: { method: string } }).input.method = "TRACE";
      const outcome = indexSettledPayment(
        store,
        makePayload({ extensions: { bazaar: extension } }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_schema_validation_failed" });
      expect((outcome as { reason: string }).reason).toBeTruthy();
    });

    it("rejects a missing schema (Ajv compile fails closed)", () => {
      const store = memStore();
      const outcome = indexSettledPayment(
        store,
        makePayload({ extensions: { bazaar: { info: { input: { type: "http" } } } } }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_schema_validation_failed" });
    });

    it.each([
      ["missing resource block", undefined],
      ["missing url", {}],
      ["non-http scheme", { url: "ftp://api.example.com/x" }],
      ["javascript scheme", { url: "javascript:alert(1)" }],
      ["embedded credentials", { url: "https://user:pw@api.example.com/x" }],
      ["overlong url", { url: `https://api.example.com/${"x".repeat(2048)}` }],
    ])("rejects a payload with %s", (_name, resource) => {
      const store = memStore();
      const outcome = indexSettledPayment(
        store,
        makePayload({ resource: resource as Record<string, unknown> | undefined }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_resource_url_invalid" });
      expect(store.count()).toBe(0);
    });
  });

  describe("field-level soft-drops (listing still indexed)", () => {
    it.each([
      ["percent-encoded traversal", "/users/%2e%2e/admin"],
      ["plain traversal", "/users/../admin"],
      ["scheme injection", "/x/:a/http://evil.example"],
      ["missing leading slash", "users/:userId"],
    ])("drops a hostile routeTemplate (%s) and falls back to the concrete path", (_n, tpl) => {
      const store = memStore();
      const extension = { ...makeGetExtension(), routeTemplate: tpl };
      const payload = makePayload({
        resource: { url: "https://api.example.com/users/123" },
        extensions: { bazaar: extension },
      });

      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);

      // F-030: an invalid template is discarded, never fatal — the listing
      // lands under the concrete request path.
      expect(outcome).toMatchObject({
        status: "indexed",
        resource: "https://api.example.com/users/123",
      });
    });

    it("drops hostile service metadata per F-031 and indexes the rest", () => {
      const store = memStore();
      const payload = makePayload({
        resource: {
          url: "https://api.example.com/weather",
          description: "Weather data endpoint",
          serviceName: "x".repeat(33),
          tags: ["ok-tag", "OK-TAG", "bell", "x".repeat(33), "two", "three", "four", "five"],
          iconUrl: "http://127.0.0.1/icon.png",
        },
      });

      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);

      expect(outcome).toMatchObject({ status: "indexed" });
      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing?.serviceName).toBeUndefined();
      expect(listing?.iconUrl).toBeUndefined();
      // Dedup is case-insensitive, invalid entries dropped, capped at 5.
      expect(listing?.tags).toEqual(["ok-tag", "two", "three", "four", "five"]);
    });

    it("drops an oversized description but keeps the listing", () => {
      const store = memStore();
      const payload = makePayload({
        resource: { url: "https://api.example.com/weather", description: "y".repeat(4096) },
      });
      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);
      expect(outcome).toMatchObject({ status: "indexed" });
      expect(store.getListing("https://api.example.com/weather", "http", "")?.description).toBeUndefined();
    });
  });

  describe("write poisoning (DECISIONS D-024)", () => {
    it("a payment to a different payTo cannot overwrite an existing listing", () => {
      const store = memStore();
      indexSettledPayment(store, makePayload(), makeRequirements(), T0);

      const hostile = makePayload({
        resource: { url: "https://api.example.com/weather", description: "POISONED" },
      });
      const outcome = indexSettledPayment(
        store,
        hostile,
        makeRequirements({ payTo: SELLER_B }),
        T1,
      );

      expect(outcome).toMatchObject({
        status: "rejected",
        code: "bazaar_listing_owned_by_other_payee",
      });
      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing?.description).toBe("Weather data endpoint");
      expect(listing?.ownerPayTo).toBe(SELLER_A);
    });

    it("the identity is the settled payTo, not any client-echoed field", () => {
      const store = memStore();
      indexSettledPayment(store, makePayload(), makeRequirements(), T0);

      // The hostile client faithfully echoes the victim's resource block —
      // only its settled payment recipient differs. Still rejected: identity
      // comes from the verified requirements, not from anything echoable.
      const outcome = indexSettledPayment(
        store,
        makePayload(),
        makeRequirements({ payTo: SELLER_B }),
        T1,
      );
      expect(outcome).toMatchObject({
        status: "rejected",
        code: "bazaar_listing_owned_by_other_payee",
      });
    });

    it("the same owner can update its own listing", () => {
      const store = memStore();
      indexSettledPayment(store, makePayload(), makeRequirements(), T0);
      const outcome = indexSettledPayment(
        store,
        makePayload({
          resource: { url: "https://api.example.com/weather", description: "v2 of the docs" },
        }),
        makeRequirements(),
        T1,
      );
      expect(outcome).toMatchObject({ status: "indexed", upsert: "updated" });
      expect(store.getListing("https://api.example.com/weather", "http", "")?.description).toBe(
        "v2 of the docs",
      );
    });
  });

  describe("the never-throws invariant (DECISIONS D-015)", () => {
    it("returns an error outcome when the store fails, and the header encoder omits it", () => {
      const store = new BazaarStore(":memory:");
      store.close(); // every subsequent statement now throws

      const outcome = indexSettledPayment(store, makePayload(), makeRequirements(), T0);

      expect(outcome.status).toBe("error");
      expect(encodeExtensionResponses(outcome)).toBeUndefined();
    });
  });
});

describe("encodeExtensionResponses (FACTS F-024)", () => {
  it("encodes success as base64 JSON keyed by extension name", () => {
    const header = encodeExtensionResponses({
      status: "indexed",
      resource: "https://api.example.com/weather",
      type: "http",
      toolName: "",
      upsert: "created",
    });
    expect(header).toBeDefined();
    expect(JSON.parse(Buffer.from(header as string, "base64").toString("utf8"))).toEqual({
      bazaar: { status: "success" },
    });
  });

  it("encodes rejection with the human reason and the machine code (D-014)", () => {
    const header = encodeExtensionResponses({
      status: "rejected",
      code: "bazaar_spec_validation_failed",
      reason: "The discovery info violates the bazaar protocol invariants.",
    });
    const decoded = JSON.parse(Buffer.from(header as string, "base64").toString("utf8")) as {
      bazaar: Record<string, unknown>;
    };
    expect(decoded.bazaar.status).toBe("rejected");
    expect(decoded.bazaar.rejectedReason).toContain("protocol invariants");
    expect(decoded.bazaar.code).toBe("bazaar_spec_validation_failed");
  });
});
