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

  describe("bounded-work invariant — Ajv ReDoS guard (DECISIONS D-015)", () => {
    it("indexes fast when the client schema carries a catastrophic-backtracking pattern", () => {
      const store = memStore();
      // Evil pattern + matching info: against the raw SDK path this drives Ajv
      // to tens of seconds on ~140 bytes (reproduced). The indexer strips
      // regex keywords before compile, so the pattern is inert. `info` still
      // shape-validates (the pattern constraint is simply gone), the listing
      // is cataloged, and the whole call returns well under a second.
      const extension = makeGetExtension();
      (extension.schema as { properties: Record<string, unknown> }).properties.evil = {
        type: "string",
        pattern: "^(a+)+$",
      };
      (extension.info as { evil?: string }).evil = "a".repeat(40) + "!";
      const payload = makePayload({
        resource: { url: "https://api.example.com/weather" },
        extensions: { bazaar: extension },
      });

      const start = performance.now();
      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);
      const elapsedMs = performance.now() - start;

      expect(outcome.status).toBe("indexed");
      expect(elapsedMs).toBeLessThan(1000);
    });

    it("also neutralizes a patternProperties (regex-keyed) schema", () => {
      const store = memStore();
      const extension = makeGetExtension();
      (extension.schema as Record<string, unknown>).patternProperties = {
        "^(x+)+$": { type: "string" },
      };
      (extension.info as Record<string, unknown>)["x".repeat(40) + "!"] = "y";
      const payload = makePayload({
        resource: { url: "https://api.example.com/weather" },
        extensions: { bazaar: extension },
      });

      const start = performance.now();
      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(outcome.status).toBe("indexed");
    });

    it("rejects a schema that blows the node budget with a distinct machine code", () => {
      const store = memStore();
      // >2000 nodes but only a few KiB serialized — trips the node budget, not
      // the 64 KiB byte cap, so the distinct too-complex code is what fires.
      const huge = { enum: Array.from({ length: 2500 }, (_, i) => i) };
      const extension = { ...makeGetExtension(), schema: huge };
      const outcome = indexSettledPayment(
        store,
        makePayload({ extensions: { bazaar: extension } }),
        makeRequirements(),
        T0,
      );
      expect(outcome).toMatchObject({ status: "rejected", code: "bazaar_schema_too_complex" });
      expect(store.count()).toBe(0);
    });
  });

  describe("routeTemplate hardening beyond the SDK (RFP 3.B)", () => {
    it.each([
      ["double-encoded traversal", "/users/%252e%252e/admin"],
      ["protocol-relative authority", "//evil.example/x"],
      ["percent-encoded null byte", "/a/%00/b"],
      ["backslash traversal", "/a/..\\b"],
    ])(
      "drops a hostile routeTemplate the SDK would accept (%s) and falls back to the concrete path",
      (_n, tpl) => {
        const store = memStore();
        const extension = { ...makeGetExtension(), routeTemplate: tpl };
        const payload = makePayload({
          resource: { url: "https://api.example.com/users/123" },
          extensions: { bazaar: extension },
        });

        const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);

        expect(outcome).toMatchObject({
          status: "indexed",
          resource: "https://api.example.com/users/123",
        });
        // The hostile template never became part of the catalog key.
        expect(store.getListing("https://api.example.com/users/123", "http", "")).toBeDefined();
      },
    );
  });

  describe("soft-drop audit log (RFP task 3.A)", () => {
    it("records one row per validated-away field, keyed to the listing", () => {
      const store = memStore();
      const extension = { ...makeGetExtension(), routeTemplate: "/users/%252e%252e/admin" };
      const payload = makePayload({
        resource: {
          url: "https://api.example.com/users/123",
          serviceName: "x".repeat(33),
          iconUrl: "http://127.0.0.1/icon.png",
        },
        extensions: { bazaar: extension },
      });

      const outcome = indexSettledPayment(store, payload, makeRequirements(), T0);
      expect(outcome.status).toBe("indexed");

      const key = BazaarStore.softDropKey("https://api.example.com/users/123", "http", "");
      const drops = store.softDropsFor(key);
      const fields = drops.map(d => d.field).sort();
      expect(fields).toEqual(["iconUrl", "routeTemplate", "serviceName"]);
      expect(drops.every(d => d.at === T0)).toBe(true);
      expect(drops.find(d => d.field === "routeTemplate")?.reasonCode).toBe("route_template_unsafe");
    });

    it("writes no soft-drop rows for a fully-valid listing", () => {
      const store = memStore();
      indexSettledPayment(store, makePayload(), makeRequirements(), T0);
      const key = BazaarStore.softDropKey("https://api.example.com/weather", "http", "");
      expect(store.softDropsFor(key)).toEqual([]);
    });
  });

  describe("same-owner update merges, never blanks (DECISIONS D-024)", () => {
    it("a sparse resettle to the seller's own payTo cannot erase existing metadata", () => {
      const store = memStore();
      // First settlement establishes rich metadata.
      indexSettledPayment(
        store,
        makePayload({
          resource: {
            url: "https://api.example.com/weather",
            description: "Weather data endpoint",
            serviceName: "Acme Weather",
            tags: ["weather", "forecast"],
          },
        }),
        makeRequirements(),
        T0,
      );

      // A hostile buyer echoes a stripped extension (no description/service/tags)
      // to the SAME listing, paying the seller's own payTo. Merge semantics keep
      // the seller's metadata intact.
      const stripped = makePayload({
        resource: { url: "https://api.example.com/weather" },
      });
      const outcome = indexSettledPayment(store, stripped, makeRequirements(), T1);

      expect(outcome).toMatchObject({ status: "indexed", upsert: "updated" });
      const listing = store.getListing("https://api.example.com/weather", "http", "");
      expect(listing?.description).toBe("Weather data endpoint");
      expect(listing?.serviceName).toBe("Acme Weather");
      expect(listing?.tags).toEqual(["weather", "forecast"]);
    });

    it("still overwrites a field the resettle DOES provide", () => {
      const store = memStore();
      indexSettledPayment(
        store,
        makePayload({
          resource: { url: "https://api.example.com/weather", description: "v1" },
        }),
        makeRequirements(),
        T0,
      );
      indexSettledPayment(
        store,
        makePayload({
          resource: { url: "https://api.example.com/weather", description: "v2 of the docs" },
        }),
        makeRequirements(),
        T1,
      );
      expect(store.getListing("https://api.example.com/weather", "http", "")?.description).toBe(
        "v2 of the docs",
      );
    });
  });

  describe("URL squatting — the attacker-FIRST ordering (known limitation)", () => {
    // This documents CURRENT behavior, not a defended property. A settled
    // payment carries no proof that its payTo controls the echoed resource.url
    // origin, so whoever settles FIRST for a (resource, type, toolName) key owns
    // it. EVIDENCE S3-4 only exercised the honest-first order; this locks in the
    // real attacker-first outcome so the limitation is visible and tested rather
    // than hidden. See DECISIONS D-032 and THREAT-MODEL "Discovery URL squatting".
    it("an attacker who settles first squats a victim's URL and locks the real seller out", () => {
      const store = memStore();
      const victimUrl = "https://weather.victim.example/current";

      // Attacker settles a dust self-payment (payTo = attacker = SELLER_B) while
      // echoing the victim's URL and attacker-authored metadata.
      const attackerPayload = makePayload({
        resource: { url: victimUrl, description: "ATTACKER COPY", serviceName: "Not The Victim" },
      });
      const first = indexSettledPayment(
        store,
        attackerPayload,
        makeRequirements({ payTo: SELLER_B }),
        T0,
      );
      expect(first).toMatchObject({ status: "indexed", upsert: "created" });

      // The real seller's later honest settlement to their own payTo is now
      // rejected — they are locked out of their own URL.
      const victim = indexSettledPayment(
        store,
        makePayload({ resource: { url: victimUrl, description: "The real service" } }),
        makeRequirements({ payTo: SELLER_A }),
        T1,
      );
      expect(victim).toMatchObject({
        status: "rejected",
        code: "bazaar_listing_owned_by_other_payee",
      });

      // The squatted, attacker-owned listing is what the catalog serves.
      const listing = store.getListing(victimUrl, "http", "");
      expect(listing?.ownerPayTo).toBe(SELLER_B);
      expect(listing?.serviceName).toBe("Not The Victim");
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
