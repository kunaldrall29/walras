import { afterEach, describe, expect, it } from "vitest";
import {
  fixtureFeeBumpKeypair,
  fixtureSubmitterKeypair,
  fixtures,
  startHarness,
  type Harness,
} from "./helpers/harness.js";

/**
 * The Stellar payment kind advertised by `https://x402.org/facilitator/supported`,
 * captured live on 2026-08-02 and recorded verbatim in EVIDENCE S0-2 (FACTS F-041).
 *
 * The RFP names x402.org as the conformance baseline: behaviour it requires should be
 * verifiable by pointing the same stock client at both it and this deliverable. Asserting
 * against the captured value turns that from an intention into a check that fails if
 * walras ever drifts from the reference operator's advertised shape.
 */
const X402_ORG_STELLAR_KIND = {
  x402Version: 2,
  scheme: "exact",
  network: "stellar:testnet",
  extra: { areFeesSponsored: true },
} as const;

describe("GET /supported", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  it("returns kinds, extensions, and signers — all three required", async () => {
    harness = await startHarness();

    const response = await harness.app.inject({ method: "GET", url: "/supported" });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    // FACTS F-040, spec section 7.3.1: none of these three is optional.
    expect(Array.isArray(body.kinds)).toBe(true);
    expect(Array.isArray(body.extensions)).toBe(true);
    expect(typeof body.signers).toBe("object");
    expect(body.signers).not.toBeNull();
  });

  it("advertises the Stellar exact kind with extra.areFeesSponsored", async () => {
    harness = await startHarness();

    const body = (await harness.app.inject({ method: "GET", url: "/supported" })).json();

    expect(body.kinds).toHaveLength(1);
    const [kind] = body.kinds;

    expect(kind.x402Version).toBe(2);
    expect(kind.scheme).toBe("exact");
    expect(kind.network).toBe(fixtures.network);
    // FACTS F-041 / F-006: fees are sponsored, and clients learn that here.
    expect(kind.extra).toEqual({ areFeesSponsored: true });
  });

  it("matches the reference operator's advertised Stellar kind exactly", async () => {
    harness = await startHarness();

    const body = (await harness.app.inject({ method: "GET", url: "/supported" })).json();
    const stellarKind = body.kinds.find(
      (kind: { network: string }) => kind.network === "stellar:testnet",
    );

    expect(stellarKind).toEqual(X402_ORG_STELLAR_KIND);
  });

  it("maps the CAIP-2 family pattern to the submitter's public address", async () => {
    harness = await startHarness();

    const body = (await harness.app.inject({ method: "GET", url: "/supported" })).json();

    // FACTS F-040: signers is keyed by CAIP-2 pattern, matching x402.org's `stellar:*`.
    expect(Object.keys(body.signers)).toEqual(["stellar:*"]);
    expect(body.signers["stellar:*"]).toEqual([fixtureSubmitterKeypair().publicKey()]);
  });

  it("includes the fee account among the signers when one is configured", async () => {
    const feeAccount = fixtureFeeBumpKeypair();
    harness = await startHarness({ env: { FEE_BUMP_SECRET: feeAccount.secret() } });

    const body = (await harness.app.inject({ method: "GET", url: "/supported" })).json();

    // Both accounts are disclosed, as x402.org discloses its two (FACTS F-041, F-055).
    expect(body.signers["stellar:*"]).toEqual([
      fixtureSubmitterKeypair().publicKey(),
      feeAccount.publicKey(),
    ]);
  });

  it("advertises bazaar now that the discovery endpoint is reachable", async () => {
    harness = await startHarness();

    const body = (await harness.app.inject({ method: "GET", url: "/supported" })).json();

    // DECISIONS D-016: `bazaar` was deliberately absent until this same change mounted
    // GET /discovery/resources — advertised and reachable move together, in both
    // directions (the "advertised vs reachable support" gap the RFP screens for, D-010).
    expect(body.extensions).toEqual(["bazaar"]);
  });

  it("needs no network access to answer", async () => {
    harness = await startHarness();

    await harness.app.inject({ method: "GET", url: "/supported" });

    expect(harness.rpc.calls).toHaveLength(0);
  });
});

describe("unknown routes", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  it("returns a machine-readable code rather than a bare 404", async () => {
    harness = await startHarness();

    // /discovery/search is real in the spec but not mounted yet — precisely the
    // kind of probe that must get a named rejection, not a silent 404 (D-016).
    const response = await harness.app.inject({ method: "GET", url: "/discovery/search" });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe("walras_unknown_route");
    expect(body.error.reason.length).toBeGreaterThan(0);
  });
});

describe("GET /health", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  it("reports the operating configuration without leaking secrets", async () => {
    harness = await startHarness();

    const response = await harness.app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.status).toBe("ok");
    expect(body.network).toBe(fixtures.network);
    expect(body.feeMode).toBe("free");
    expect(body.submitters).toEqual([fixtureSubmitterKeypair().publicKey()]);

    // No secret seed anywhere in the response, under any key.
    expect(JSON.stringify(body)).not.toContain(fixtureSubmitterKeypair().secret());
  });
});
