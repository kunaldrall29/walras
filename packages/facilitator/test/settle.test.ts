import { xdr } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  fixtureFeeBumpKeypair,
  fixtureSubmitterKeypair,
  fixtures,
  requestBody,
  startHarness,
  type Harness,
} from "./helpers/harness.js";

/**
 * `POST /settle` against the real `ExactStellarScheme`, backed by the Soroban RPC double.
 *
 * The successful settlements here are **modelled, not on-chain**: the double accepts the
 * submission and reports confirmation without a ledger behind it. What that proves is the
 * response contract — `{ success, transaction, network, payer }` with a 64-character hex
 * hash (FACTS F-038) — and the control flow around it. It proves nothing about funds
 * moving, and is never reported as if it did.
 */
describe("POST /settle", () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.close();
  });

  describe("wire shape", () => {
    it("returns the spec section 5.3 SettleResponse on success", async () => {
      harness = await startHarness();

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.success).toBe(true);
      expect(body.network).toBe(fixtures.network);
      // FACTS F-038: a 64-character hex transaction hash, and the payer is the client.
      expect(body.transaction).toMatch(/^[0-9a-f]{64}$/);
      expect(body.transaction).toBe(harness.rpc.lastSubmittedHash);
      expect(body.payer).toBe(fixtures.accounts.payer);
      expect(body.payer).not.toBe(fixtures.accounts.submitter);
      expect(body.errorReason).toBeUndefined();
    });

    it("returns an empty transaction hash when settlement fails", async () => {
      harness = await startHarness();

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.wrongAmount!.payload),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      expect(body.success).toBe(false);
      // Spec section 5.3.2: `transaction` is required and is the empty string on failure.
      expect(body.transaction).toBe("");
      expect(body.network).toBe(fixtures.network);
    });
  });

  describe("settle verifies independently", () => {
    // FACTS F-036 / spec Protocol Flow step 10: settle MUST perform full verification and
    // MUST NOT assume a prior /verify. These cases never call /verify first.
    const cases: Array<[string, string]> = [
      ["wrongAmount", "invalid_exact_stellar_payload_wrong_amount"],
      ["wrongAsset", "invalid_exact_stellar_payload_wrong_asset"],
      ["wrongRecipient", "invalid_exact_stellar_payload_wrong_recipient"],
      ["expirationTooFar", "invalid_exact_stellar_signature_expiration_too_far"],
      ["tamperedAuthSignature", "invalid_exact_stellar_payload_simulation_failed"],
      ["facilitatorIsPayer", "invalid_exact_stellar_payload_facilitator_is_payer"],
    ];

    it.each(cases)("%s is rejected at settle with %s", async (caseName, expectedReason) => {
      harness = await startHarness();

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases[caseName]!.payload),
      });

      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.errorReason).toBe(expectedReason);
      expect(body.errorMessage).toBeTypeOf("string");
      expect(body.errorMessage.length).toBeGreaterThan(0);
      // Nothing was broadcast.
      expect(harness.rpc.calls).not.toContain("sendTransaction");
    });

    it("re-simulates at settle time rather than trusting an earlier verify", async () => {
      harness = await startHarness();

      await harness.app.inject({
        method: "POST",
        url: "/verify",
        payload: requestBody(fixtures.cases.valid!.payload),
      });
      const afterVerify = harness.rpc.calls.filter(c => c === "simulateTransaction").length;

      await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload),
      });
      const afterSettle = harness.rpc.calls.filter(c => c === "simulateTransaction").length;

      expect(afterVerify).toBe(1);
      expect(afterSettle).toBeGreaterThan(afterVerify);
    });

    it("settles without any prior verify call", async () => {
      harness = await startHarness();

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload),
      });

      expect(response.json().success).toBe(true);
    });
  });

  describe("submission outcomes", () => {
    it("reports submission failure when the network rejects the transaction", async () => {
      harness = await startHarness({ sendStatus: "ERROR" });

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload),
      });

      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.errorReason).toBe("settle_exact_stellar_transaction_submission_failed");
      expect(body.transaction).toBe("");
    });

    it("reports on-chain failure and keeps the hash for auditing", async () => {
      harness = await startHarness({ transactionStatus: "FAILED" });

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload),
      });

      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.errorReason).toBe("settle_exact_stellar_transaction_failed");
      // A submitted-but-failed transaction still has a hash worth reporting.
      expect(body.transaction).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("fee sponsorship", () => {
    it("sources the settlement transaction from the configured submitter", async () => {
      harness = await startHarness();

      await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload),
      });

      const envelope = xdr.TransactionEnvelope.fromXDR(harness.rpc.lastSubmittedEnvelope!, "base64");
      const sourceAccount = envelope.v1().tx().sourceAccount();
      const submitterKey = fixtureSubmitterKeypair().xdrMuxedAccount();

      // The buyer never spends a sequence number and never pays a fee; the submitter does
      // both. That is what "fees sponsored by a configured submitter account" means here.
      expect(sourceAccount.toXDR("base64")).toBe(submitterKey.toXDR("base64"));
    });

    it("wraps settlement in a fee bump when a fee account is configured", async () => {
      // DECISIONS D-012: the reference operator settles this way in production
      // (FACTS F-055, source_account != fee_account).
      const feeAccount = fixtureFeeBumpKeypair();
      harness = await startHarness({ env: { FEE_BUMP_SECRET: feeAccount.secret() } });

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload),
      });

      expect(response.json().success).toBe(true);
      const envelope = xdr.TransactionEnvelope.fromXDR(harness.rpc.lastSubmittedEnvelope!, "base64");
      expect(envelope.switch().name).toBe("envelopeTypeTxFeeBump");

      // Fee payment and sequence-number management are decoupled: the fee source is the
      // dedicated fee account, the inner source is still the submitter.
      const feeSource = envelope.feeBump().tx().feeSource();
      expect(feeSource.toXDR("base64")).toBe(feeAccount.xdrMuxedAccount().toXDR("base64"));
      const innerSource = envelope.feeBump().tx().innerTx().v1().tx().sourceAccount();
      expect(innerSource.toXDR("base64")).toBe(
        fixtureSubmitterKeypair().xdrMuxedAccount().toXDR("base64"),
      );
    });
  });

  describe("envelope rejections", () => {
    it("rejects a malformed body in SettleResponse shape", async () => {
      harness = await startHarness();

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        headers: { "content-type": "application/json" },
        payload: "{",
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.success).toBe(false);
      expect(body.errorReason).toBe("walras_malformed_request_body");
      expect(body.transaction).toBe("");
      // Falls back to the configured network when the body names none.
      expect(body.network).toBe(fixtures.network);
    });

    it("reports the requested network on an unsupported kind", async () => {
      harness = await startHarness();

      const response = await harness.app.inject({
        method: "POST",
        url: "/settle",
        payload: requestBody(fixtures.cases.valid!.payload, {
          ...fixtures.requirements,
          network: "eip155:8453",
        }),
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.errorReason).toBe("walras_unsupported_kind");
      expect(body.network).toBe("eip155:8453");
    });
  });
});
