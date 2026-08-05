/**
 * Environment configuration for the walras MCP server.
 *
 * Fail-fast at boot (EX_CONFIG), mirroring the facilitator's config
 * discipline: a malformed wallet seed or cap must never surface later as a
 * confusing payment failure.
 */

/** Parsed configuration. */
export interface McpServerConfig {
  /** Base URL of the walras facilitator (discovery endpoints). */
  facilitatorUrl: string;
  /** The one network this server's wallet pays on. */
  network: string;
  /** Per-call spend cap in asset base units (USDC: 7 decimals, F-008). */
  maxAmount: bigint;
  /** ed25519 seed (S...) for the paying wallet; null disables paid_call. */
  walletSecret: string | null;
}

/** Raised for malformed configuration; the entry point exits 78 on it. */
export class ConfigError extends Error {}

/** Default per-call cap: 1 USDC = 10^7 base units (7 decimals, FACTS F-008). */
const DEFAULT_MAX_AMOUNT = 10_000_000n;

/**
 * Loads configuration from the environment.
 *
 * @param env - The environment map (injectable for tests).
 * @returns The parsed configuration.
 * @throws {ConfigError} When a value is present but malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const facilitatorUrl = env.FACILITATOR_URL ?? "http://127.0.0.1:4021";
  try {
    void new URL(facilitatorUrl);
  } catch {
    throw new ConfigError(`FACILITATOR_URL is not a URL: ${facilitatorUrl}`);
  }

  const network = env.WALRAS_MCP_NETWORK ?? "stellar:testnet";

  let maxAmount = DEFAULT_MAX_AMOUNT;
  const rawCap = env.WALRAS_MCP_MAX_AMOUNT;
  if (rawCap !== undefined && rawCap !== "") {
    try {
      maxAmount = BigInt(rawCap);
    } catch {
      throw new ConfigError(`WALRAS_MCP_MAX_AMOUNT is not an integer of base units: ${rawCap}`);
    }
    if (maxAmount < 0n) {
      throw new ConfigError(`WALRAS_MCP_MAX_AMOUNT must be non-negative: ${rawCap}`);
    }
  }

  let walletSecret: string | null = null;
  const rawSecret = env.CLIENT_STELLAR_PRIVATE_KEY;
  if (rawSecret !== undefined && rawSecret !== "") {
    // Shape check only (S + base32, 56 chars) — catches the .env.example
    // placeholder surviving into .env, the S5 fresh-clone trap.
    if (!/^S[A-Z2-7]{55}$/.test(rawSecret)) {
      throw new ConfigError(
        "CLIENT_STELLAR_PRIVATE_KEY is set but is not an ed25519 seed (S..., 56 chars). " +
          "Remove it to run search-only, or paste a real seed (scripts/setup-accounts.mjs).",
      );
    }
    walletSecret = rawSecret;
  }

  return { facilitatorUrl, network, maxAmount, walletSecret };
}
