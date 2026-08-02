import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtures, requestBody, startHarness, type Harness } from "./helpers/harness.js";

/**
 * `POST /verify` against the real `ExactStellarScheme`, backed by the Soroban RPC double.
 *
 * Every negative case asserts two things: that the payment was rejected, and that it was
 * rejected for the *specific* reason the spec names. A test that only checked
 * `isValid === false` would pass just as happily if every payload failed for the same
 * accidental reason — which is precisely what happens without the RPC double, since
 * simulation would collapse all of them into `..._simulation_failed`.
 */
describe("POST /verify", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  describe("wire shape", () => {
    it("accepts the spec section 7.1 request body and returns a VerifyResponse", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixtures.cases.valid!.payload),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("isValid");
      expect(body.isValid).toBe(true);
      // Spec section 5.4.2: `payer` is the client's address, never the facilitator's.
      expect(body.payer).toBe(fixtures.accounts.payer);
      expect(body.payer).not.toBe(fixtures.accounts.submitter);
      expect(body.invalidReason).toBeUndefined();
    });

    it("returns 200 with isValid false for a rejected payment, not a 4xx", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixtures.cases.wrongAmount!.payload),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().isValid).toBe(false);
    });
  });

  describe("rejections carry a code and a non-null reason", () => {
    const cases: Array<[string, string]> = [
      ["wrongAmount", "invalid_exact_stellar_payload_wrong_amount"],
      ["wrongAsset", "invalid_exact_stellar_payload_wrong_asset"],
      ["wrongRecipient", "invalid_exact_stellar_payload_wrong_recipient"],
      ["facilitatorIsPayer", "invalid_exact_stellar_payload_facilitator_is_payer"],
      ["facilitatorIsTxSource", "invalid_exact_stellar_payload_unsafe_tx_or_op_source"],
      ["wrongOperation", "invalid_exact_stellar_payload_wrong_operation"],
      ["malformedTransaction", "invalid_exact_stellar_payload_malformed"],
      ["expirationTooFar", "invalid_exact_stellar_signature_expiration_too_far"],
      ["unsignedAuthEntry", "invalid_exact_stellar_payload_missing_payer_signature"],
      ["hasSubInvocations", "invalid_exact_stellar_payload_has_subinvocations"],
      ["noAuthEntries", "invalid_exact_stellar_payload_no_auth_entries"],
      ["tamperedAuthSignature", "invalid_exact_stellar_payload_simulation_failed"],
    ];

    it.each(cases)("%s is rejected with %s", async (caseName, expectedReason) => {
      const fixture = fixtures.cases[caseName];
      expect(fixture, `fixture '${caseName}' is missing`).toBeDefined();

      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixture!.payload),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.isValid).toBe(false);
      expect(body.invalidReason).toBe(expectedReason);
      // RFP 3.6: a machine-readable code is not enough on its own.
      expect(body.invalidMessage).toBeTypeOf("string");
      expect(body.invalidMessage.length).toBeGreaterThan(0);
    });
  });

  describe("tampered authorization entry", () => {
    it("is structurally indistinguishable from the valid payload", () => {
      const valid = fixtures.cases.valid!.payload.payload as { transaction: string };
      const tampered = fixtures.cases.tamperedAuthSignature!.payload.payload as {
        transaction: string;
      };

      // Same length, different bytes: only the signature changed. Nothing the facilitator
      // package inspects on its own can tell these apart — `gatherAuthEntrySignatureStatus`
      // asks whether a signature is present, not whether it verifies.
      expect(tampered.transaction).not.toBe(valid.transaction);
      expect(tampered.transaction.length).toBe(valid.transaction.length);
    });

    it("is rejected once the signature is actually checked", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixtures.cases.tamperedAuthSignature!.payload),
      });

      const body = response.json();
      expect(body.isValid).toBe(false);
      expect(body.invalidReason).toBe("invalid_exact_stellar_payload_simulation_failed");
      expect(body.invalidMessage).toContain("simulation");
      // Payer is still reported on rejection so a caller can attribute the failure.
      expect(body.payer).toBe(fixtures.accounts.payer);
    });
  });

  describe("protocol mismatches reach the payment scheme", () => {
    it("reports network_mismatch when the payload and requirements disagree", async () => {
      const payload = structuredClone(fixtures.cases.valid!.payload);
      payload.accepted = { ...payload.accepted, network: "stellar:pubnet" };

      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(payload),
      });

      expect(response.json().invalidReason).toBe("network_mismatch");
    });

    it("reports unsupported_scheme when only the payload's scheme is wrong", async () => {
      const payload = structuredClone(fixtures.cases.valid!.payload);
      payload.accepted = { ...payload.accepted, scheme: "upto" };

      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(payload),
      });

      expect(response.json().invalidReason).toBe("unsupported_scheme");
    });
  });

  describe("envelope rejections", () => {
    it("rejects a body that is not JSON", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        headers: { "content-type": "application/json" },
        payload: "{not json",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.isValid).toBe(false);
      expect(body.invalidReason).toBe("walras_malformed_request_body");
      expect(body.invalidMessage.length).toBeGreaterThan(0);
    });

    it("rejects a body with no paymentPayload", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: { x402Version: 2, paymentRequirements: fixtures.requirements },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().invalidReason).toBe("walras_missing_payment_payload");
    });

    it("rejects a body with no paymentRequirements", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: { x402Version: 2, paymentPayload: fixtures.cases.valid!.payload },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().invalidReason).toBe("walras_missing_payment_requirements");
    });

    it("rejects an unsupported x402 version", async () => {
      const payload = structuredClone(fixtures.cases.valid!.payload);
      payload.x402Version = 1;

      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(payload),
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.invalidReason).toBe("walras_unsupported_x402_version");
      expect(body.invalidMessage).toContain("2");
    });

    it("rejects a network this facilitator does not advertise", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixtures.cases.valid!.payload, {
          ...fixtures.requirements,
          network: "eip155:84532",
        }),
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.invalidReason).toBe("walras_unsupported_kind");
      expect(body.invalidMessage).toContain("eip155:84532");
    });
  });

  describe("facilitator safety", () => {
    // Spec section 4 lists these as separate MUST NOTs, and the package checks them at
    // different points — the source check runs before the transaction is even decoded far
    // enough to read the transfer arguments. Asserting them separately proves both guards
    // exist rather than one masking the other.
    it("refuses a transaction the client sourced from the facilitator's account", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixtures.cases.facilitatorIsTxSource!.payload),
      });

      expect(response.json().invalidReason).toBe(
        "invalid_exact_stellar_payload_unsafe_tx_or_op_source",
      );
    });

    it("refuses a transfer that would debit the facilitator's own funds", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixtures.cases.facilitatorIsPayer!.payload),
      });

      expect(response.json().invalidReason).toBe(
        "invalid_exact_stellar_payload_facilitator_is_payer",
      );
    });

    it("rejects both before any simulation is attempted", async () => {
      const before = harness.rpc.calls.filter(call => call === "simulateTransaction").length;

      for (const name of ["facilitatorIsTxSource", "facilitatorIsPayer"] as const) {
        await harness.app.inject({
          method: "POST",
          url: "/verify",
          payload: requestBody(fixtures.cases[name]!.payload),
        });
      }

      const after = harness.rpc.calls.filter(call => call === "simulateTransaction").length;
      expect(after).toBe(before);
    });
  });
});
