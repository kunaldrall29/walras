import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_REASON_CODES,
  PACKAGE_REASON_CODES,
  PACKAGE_SETTLE_REASON_CODES,
  PACKAGE_VERIFY_REASON_CODES,
  REASON_TEXT,
  WALRAS_REASON_CODES,
  WalrasRejection,
  isWalrasReasonCode,
  reasonText,
} from "../src/errors.js";

/**
 * The regex from EVIDENCE S0-6, reused verbatim.
 *
 * The character class matters. A first pass in Session 0 used `[a-z_]` and silently
 * dropped two codes — `invalid_x402_version` contains digits, and `verification_failed`
 * is reached through a `??` fallback rather than a literal assignment. `[a-z0-9_]` is the
 * corrected form, recorded so a future re-verification does not repeat the mistake.
 */
const REASON_CODE_PATTERN =
  /"(invalid|unsupported|unexpected|network|settle|verification)[a-z0-9_]*"/g;

/**
 * Extracts every reason-code string literal from the installed facilitator bundle.
 *
 * @returns The distinct codes found, sorted.
 */
function codesInInstalledPackage(): string[] {
  const require = createRequire(import.meta.url);
  const bundlePath = require.resolve("@x402/stellar/exact/facilitator");
  const source = readFileSync(bundlePath, "utf8");

  const found = new Set<string>();
  for (const match of source.matchAll(REASON_CODE_PATTERN)) {
    found.add(match[0].slice(1, -1));
  }
  return [...found].sort();
}

describe("reason codes", () => {
  describe("inherited from @x402/stellar", () => {
    it("enumerates 37 codes, 30 on verify and 7 on settle", () => {
      // FACTS F-045 / EVIDENCE S0-6.
      expect(PACKAGE_VERIFY_REASON_CODES).toHaveLength(30);
      expect(PACKAGE_SETTLE_REASON_CODES).toHaveLength(7);
      expect(new Set(PACKAGE_REASON_CODES).size).toBe(37);
    });

    it("matches the installed package exactly", () => {
      // Drift, not inability, is this project's failure mode (FACTS F-061): the @x402/*
      // packages moved 2.17.0 -> 2.20.0 in two days. If an upgrade adds, removes, or
      // renames a code, this fails and forces a FACTS update rather than letting walras
      // quietly under-report a rejection reason.
      expect(codesInInstalledPackage()).toEqual([...PACKAGE_REASON_CODES].sort());
    });

    it("keeps the walras taxonomy disjoint from the package's", () => {
      // DECISIONS D-007: never shadow an inherited code with one of our own.
      for (const code of WALRAS_REASON_CODES) {
        expect(PACKAGE_REASON_CODES).not.toContain(code);
        expect(code.startsWith("walras_")).toBe(true);
      }
    });
  });

  describe("human-readable text", () => {
    it("covers every enumerated code with a non-empty explanation", () => {
      // RFP 3.6: every rejection carries a non-null reason. The package populates a
      // message on exactly one of its paths, so walras backfills the rest from here.
      for (const code of ALL_REASON_CODES) {
        const text = REASON_TEXT[code];
        expect(text, `no text for '${code}'`).toBeTypeOf("string");
        expect(text!.length, `empty text for '${code}'`).toBeGreaterThan(0);
      }
    });

    it("has no entries for codes that are not enumerated", () => {
      expect(Object.keys(REASON_TEXT).sort()).toEqual([...ALL_REASON_CODES].sort());
    });

    it("still returns a usable reason for an unknown code", () => {
      const text = reasonText("some_future_upstream_code");

      expect(text).toContain("some_future_upstream_code");
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe("classification", () => {
    it("identifies wrapper codes", () => {
      expect(isWalrasReasonCode("walras_unsupported_kind")).toBe(true);
      expect(isWalrasReasonCode("invalid_exact_stellar_payload_wrong_amount")).toBe(false);
    });
  });

  describe("WalrasRejection", () => {
    it("defaults to a 400 and carries a non-null reason", () => {
      const rejection = new WalrasRejection("walras_missing_payment_payload");

      expect(rejection.httpStatus).toBe(400);
      expect(rejection.code).toBe("walras_missing_payment_payload");
      expect(rejection.reason).toBe(REASON_TEXT.walras_missing_payment_payload);
    });

    it("appends detail to the canonical reason without changing the code", () => {
      const rejection = new WalrasRejection("walras_unsupported_kind", {
        detail: "Received scheme 'upto' on network 'stellar:testnet'.",
      });

      expect(rejection.code).toBe("walras_unsupported_kind");
      expect(rejection.reason).toContain("GET /supported");
      expect(rejection.reason).toContain("Received scheme 'upto'");
    });
  });
});
