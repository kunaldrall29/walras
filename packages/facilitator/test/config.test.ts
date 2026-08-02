import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_DB_PATH,
  DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
  DEFAULT_PORT,
  DEFAULT_RPC_URL,
  describeConfig,
  loadConfig,
} from "../src/config.js";
import { fixtureFeeBumpKeypair, fixtureSubmitterKeypair } from "./helpers/harness.js";

const SUBMITTER = fixtureSubmitterKeypair();

/**
 * Builds an environment with the one required variable set.
 *
 * @param overrides - Additional or replacement variables.
 * @returns An environment object for `loadConfig`.
 */
function env(overrides: Record<string, string | undefined> = {}) {
  return { SUBMITTER_SECRET: SUBMITTER.secret(), ...overrides };
}

describe("loadConfig", () => {
  describe("defaults", () => {
    it("targets stellar:testnet with the public Soroban RPC and a free fee mode", () => {
      const config = loadConfig(env());

      expect(config.network).toBe("stellar:testnet");
      expect(config.rpcUrl).toBe(DEFAULT_RPC_URL);
      expect(config.port).toBe(DEFAULT_PORT);
      expect(config.feeMode).toBe("free");
      expect(config.dbPath).toBe(DEFAULT_DB_PATH);
      expect(config.maxTransactionFeeStroops).toBe(DEFAULT_MAX_TRANSACTION_FEE_STROOPS);
    });

    it("derives the submitter's public address from its secret", () => {
      const config = loadConfig(env());

      expect(config.submitterAddresses).toEqual([SUBMITTER.publicKey()]);
      expect(config.feeBumpAddress).toBeUndefined();
    });
  });

  describe("submitter", () => {
    it("is required", () => {
      expect(() => loadConfig({})).toThrow(ConfigError);
      expect(() => loadConfig({})).toThrow(/SUBMITTER_SECRET/);
    });

    it("accepts the e2e suite's variable name as an alias", () => {
      // FACTS F-056: an environment set up for the x402 e2e suite works unchanged.
      const config = loadConfig({ FACILITATOR_STELLAR_PRIVATE_KEY: SUBMITTER.secret() });

      expect(config.submitterAddresses).toEqual([SUBMITTER.publicKey()]);
    });

    it("accepts a comma-separated list for round-robin signing", () => {
      // DECISIONS D-012: several submitters is configuration, not engineering.
      const second = fixtureFeeBumpKeypair();
      const config = loadConfig(env({ SUBMITTER_SECRET: `${SUBMITTER.secret()}, ${second.secret()}` }));

      expect(config.submitterAddresses).toEqual([SUBMITTER.publicKey(), second.publicKey()]);
    });

    it("rejects a repeated account, which would defeat round-robin silently", () => {
      expect(() =>
        loadConfig(env({ SUBMITTER_SECRET: `${SUBMITTER.secret()},${SUBMITTER.secret()}` })),
      ).toThrow(/more than once/);
    });

    it("rejects a malformed seed without echoing it", () => {
      try {
        loadConfig(env({ SUBMITTER_SECRET: "SNOTAREALSEED" }));
        expect.unreachable("expected a ConfigError");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as Error).message).not.toContain("SNOTAREALSEED");
      }
    });
  });

  describe("network and RPC", () => {
    it("rejects a network outside the Stellar CAIP-2 namespace", () => {
      expect(() => loadConfig(env({ NETWORK: "eip155:8453" }))).toThrow(/NETWORK/);
    });

    it("requires an explicit RPC URL on pubnet", () => {
      // FACTS F-004: pubnet has no public default endpoint.
      expect(() => loadConfig(env({ NETWORK: "stellar:pubnet" }))).toThrow(/RPC_URL/);

      const config = loadConfig(
        env({ NETWORK: "stellar:pubnet", RPC_URL: "https://soroban.example.com" }),
      );
      expect(config.rpcUrl).toBe("https://soroban.example.com");
    });

    it("rejects a non-http RPC URL", () => {
      expect(() => loadConfig(env({ RPC_URL: "ftp://example.com" }))).toThrow(/RPC_URL/);
      expect(() => loadConfig(env({ RPC_URL: "not a url" }))).toThrow(/RPC_URL/);
    });
  });

  describe("fee mode", () => {
    it("defaults to free", () => {
      expect(loadConfig(env()).feeMode).toBe("free");
      expect(loadConfig(env({ FEE_MODE: "free" })).feeMode).toBe("free");
    });

    it("refuses a mode it does not implement rather than falling back silently", () => {
      expect(() => loadConfig(env({ FEE_MODE: "flat" }))).toThrow(/FEE_MODE/);
    });
  });

  describe("numeric bounds", () => {
    it("rejects a port outside the valid range", () => {
      expect(() => loadConfig(env({ PORT: "0" }))).toThrow(/PORT/);
      expect(() => loadConfig(env({ PORT: "70000" }))).toThrow(/PORT/);
      expect(() => loadConfig(env({ PORT: "4021.5" }))).toThrow(/PORT/);
      expect(loadConfig(env({ PORT: "8080" })).port).toBe(8080);
    });

    it("accepts an operator-raised fee ceiling", () => {
      // FACTS F-054: observed fees are ~23 073 stroops, so the 50 000 default leaves
      // roughly 2x headroom — worth being an explicit knob.
      expect(loadConfig(env({ MAX_TRANSACTION_FEE_STROOPS: "120000" })).maxTransactionFeeStroops).toBe(
        120_000,
      );
      expect(() => loadConfig(env({ MAX_TRANSACTION_FEE_STROOPS: "0" }))).toThrow(/STROOPS/);
    });
  });

  describe("catalog store", () => {
    it("carries DB_PATH through without opening anything", () => {
      // Reserved for the discovery catalog, which this session does not implement.
      const config = loadConfig(env({ DB_PATH: "/var/lib/walras/catalog.db" }));

      expect(config.dbPath).toBe("/var/lib/walras/catalog.db");
    });
  });

  describe("describeConfig", () => {
    it("omits every secret", () => {
      const feeAccount = fixtureFeeBumpKeypair();
      const config = loadConfig(env({ FEE_BUMP_SECRET: feeAccount.secret() }));
      const described = JSON.stringify(describeConfig(config));

      expect(described).not.toContain(SUBMITTER.secret());
      expect(described).not.toContain(feeAccount.secret());
      expect(described).toContain(SUBMITTER.publicKey());
      expect(described).toContain(feeAccount.publicKey());
    });
  });
});
