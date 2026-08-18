import { describe, expect, it } from "vitest";

import {
  WALRAS_MCP_REASON_CODES,
  WALRAS_MCP_REASON_TEXT,
  facilitatorError,
  isFacilitatorCode,
  mcpError,
} from "../src/errors.js";

describe("error taxonomy (D-028)", () => {
  it("every walras_mcp_* code has non-empty reason text", () => {
    for (const code of WALRAS_MCP_REASON_CODES) {
      expect(WALRAS_MCP_REASON_TEXT[code]).toBeTruthy();
      expect(code.startsWith("walras_mcp_")).toBe(true);
    }
  });

  it("mcpError yields the code and non-null reason, with optional detail", () => {
    const bare = mcpError("walras_mcp_payment_not_settled");
    expect(bare.errorCode).toBe("walras_mcp_payment_not_settled");
    expect(bare.reason.length).toBeGreaterThan(0);
    const detailed = mcpError("walras_mcp_payment_not_settled", "Extra context.");
    expect(detailed.reason).toContain("Extra context.");
    expect(detailed.reason).toContain(bare.reason);
  });

  it("recognizes facilitator scheme and envelope codes for passthrough", () => {
    // One code from each of the facilitator's taxonomies (D-007).
    expect(isFacilitatorCode("invalid_exact_stellar_payload_wrong_amount")).toBe(true);
    expect(isFacilitatorCode("verification_failed")).toBe(true);
    expect(isFacilitatorCode("walras_missing_search_query")).toBe(true);
    expect(isFacilitatorCode("walras_mcp_internal_error")).toBe(false);
    expect(isFacilitatorCode("made_up_code")).toBe(false);
  });

  it("facilitatorError passes the code through verbatim with canonical text", () => {
    const error = facilitatorError("verification_failed");
    expect(error.errorCode).toBe("verification_failed");
    expect(error.reason.length).toBeGreaterThan(0);
  });

  it("facilitatorError prefers upstream reason text when provided", () => {
    const error = facilitatorError("walras_missing_search_query", "Upstream said so.");
    expect(error.reason).toBe("Upstream said so.");
  });
});
