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

/** Default facilitator base URL — a locally running walras facilitator. */
const DEFAULT_FACILITATOR_URL = "http://127.0.0.1:4021";

/** Default network the paying wallet settles on. */
const DEFAULT_NETWORK = "stellar:testnet";

/**
 * The MCP server's configuration surface, as data — the single source
 * `pnpm docs:gen` generates its slice of `docs/reference/config.md` from
 * (writing rule R3). Shape matches the facilitator's `ConfigVarDoc`;
 * `test/config-reference.test.ts` guards against drift from `loadConfig`.
 */
export const CONFIG_REFERENCE = [
  {
    name: "FACILITATOR_URL",
    required: "no",
    defaultValue: DEFAULT_FACILITATOR_URL,
    format: "http(s) URL",
    description:
      "Base URL of the walras facilitator whose discovery endpoints search_resources " +
      "queries and whose settlements paid_call pays through.",
  },
  {
    name: "WALRAS_MCP_NETWORK",
    required: "no",
    defaultValue: DEFAULT_NETWORK,
    format: "CAIP-2 network identifier",
    description:
      "The one network this server's wallet pays on. A 402 demanding any other " +
      "network is declined by policy before anything is signed (DECISIONS D-030).",
  },
  {
    name: "WALRAS_MCP_MAX_AMOUNT",
    required: "no",
    defaultValue: `${DEFAULT_MAX_AMOUNT} (1 USDC)`,
    format: "non-negative integer, asset base units (USDC: 7 decimals, FACTS F-008)",
    description:
      "Per-call spend cap, enforced twice: as a pre-payment check against the probed " +
      "402, and as a payment-requirements policy on the shared x402 client so no " +
      "transport can bypass it (FACTS F-081; DECISIONS D-030).",
  },
  {
    name: "CLIENT_STELLAR_PRIVATE_KEY",
    required: "no",
    defaultValue: null,
    format: "'S...' Ed25519 secret seed (56 chars)",
    description:
      "The paying wallet. Unset, the server runs search-only and paid_call names the " +
      "gap (walras_mcp_wallet_not_configured). A malformed value — including the " +
      ".env.example placeholder — is a startup error (exit 78), never a late payment " +
      "failure.",
  },
] as const;

/**
 * Loads configuration from the environment.
 *
 * @param env - The environment map (injectable for tests).
 * @returns The parsed configuration.
 * @throws {ConfigError} When a value is present but malformed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const facilitatorUrl = env.FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL;
  try {
    void new URL(facilitatorUrl);
  } catch {
    throw new ConfigError(`FACILITATOR_URL is not a URL: ${facilitatorUrl}`);
  }

  const network = env.WALRAS_MCP_NETWORK ?? DEFAULT_NETWORK;

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
