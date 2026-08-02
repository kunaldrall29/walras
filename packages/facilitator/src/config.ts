import { Keypair } from "@stellar/stellar-sdk";
import {
  DEFAULT_TESTNET_RPC_URL,
  STELLAR_PUBNET_CAIP2,
  STELLAR_TESTNET_CAIP2,
} from "@x402/stellar";
import type { Network } from "@x402/core/types";

/**
 * Configuration surface for the walras facilitator.
 *
 * Note on taxonomies: the codes in `errors.ts` describe *wire* rejections — things a
 * caller did. A bad configuration is not a wire rejection; it is a startup fault the
 * operator must fix, so it throws `ConfigError` and the process never binds a port.
 * Failing loudly at boot is deliberate: a facilitator that starts with a half-valid
 * config would advertise capability it cannot honour.
 */

/** The default Soroban RPC endpoint used when `RPC_URL` is unset on testnet (FACTS F-004). */
export const DEFAULT_RPC_URL = DEFAULT_TESTNET_RPC_URL;

/** Default listen port. Matches the port the pre-build testing doc scripts against. */
export const DEFAULT_PORT = 4021;

/**
 * Default settlement-fee safety ceiling in stroops (FACTS F-037).
 *
 * Real measured settlements run at ~23 073 stroops (FACTS F-054), so this default
 * leaves roughly 2x headroom. It is surfaced as an operator knob rather than left
 * implicit precisely because that margin is thinner than it looks.
 */
export const DEFAULT_MAX_TRANSACTION_FEE_STROOPS = 50_000;

/** Default path for the discovery catalog store. Reserved; unused until the catalog ships. */
export const DEFAULT_DB_PATH = "./data/catalog.db";

/**
 * Facilitator fee posture.
 *
 * `free` — walras takes no service fee on top of the network fee it sponsors, per RFP 3.1.
 * It is the only implemented mode; the enum exists so a future fee-taking mode is a
 * config change with an explicit name rather than a silent behavioural drift.
 */
export const FEE_MODES = ["free"] as const;
export type FeeMode = (typeof FEE_MODES)[number];

/** Networks this facilitator can be configured for (FACTS F-004). */
export const SUPPORTED_NETWORKS = [STELLAR_TESTNET_CAIP2, STELLAR_PUBNET_CAIP2] as const;

export interface FacilitatorConfig {
  /** CAIP-2 network this facilitator serves. */
  readonly network: Network;
  /** Soroban RPC endpoint used for simulation, submission, and ledger reads. */
  readonly rpcUrl: string;
  /**
   * Secret seeds for the accounts that source settlement transactions and pay their
   * fees. At least one. Multiple entries enable the package's round-robin signer
   * selection (DECISIONS D-012).
   */
  readonly submitterSecrets: readonly string[];
  /** Public addresses derived from `submitterSecrets`, in the same order. */
  readonly submitterAddresses: readonly string[];
  /** Optional secret seed for a dedicated fee account used as a fee-bump source (D-012). */
  readonly feeBumpSecret: string | undefined;
  /** Public address derived from `feeBumpSecret`, when configured. */
  readonly feeBumpAddress: string | undefined;
  /** TCP port to listen on. */
  readonly port: number;
  /** Facilitator fee posture. */
  readonly feeMode: FeeMode;
  /** Filesystem path for the discovery catalog store. Reserved; not opened yet. */
  readonly dbPath: string;
  /** Settlement-fee safety ceiling in stroops, passed through to the payment scheme. */
  readonly maxTransactionFeeStroops: number;
}

/** Raised when the environment cannot produce a valid, complete configuration. */
export class ConfigError extends Error {
  /** The environment variable at fault. */
  readonly field: string;

  /**
   * Creates a configuration error naming the offending variable.
   *
   * @param field - The environment variable at fault.
   * @param message - What is wrong with it, and what a valid value looks like.
   */
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ConfigError";
    this.field = field;
  }
}

/** Environment source. `process.env`-shaped, injectable so tests need no global mutation. */
export type Env = Record<string, string | undefined>;

/**
 * Reads a variable, treating whitespace-only values as absent.
 *
 * @param env - The environment to read from.
 * @param key - Variable name.
 * @returns The trimmed value, or undefined when unset or blank.
 */
function read(env: Env, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Parses an integer-valued variable within an inclusive range.
 *
 * @param env - The environment to read from.
 * @param key - Variable name.
 * @param fallback - Value used when the variable is unset.
 * @param min - Minimum permitted value, inclusive.
 * @param max - Maximum permitted value, inclusive.
 * @returns The parsed integer.
 * @throws {ConfigError} When the value is not an integer in range.
 */
function readInt(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = read(env, key);
  if (raw === undefined) return fallback;
  if (!/^-?\d+$/.test(raw)) {
    throw new ConfigError(key, `expected an integer, got '${raw}'`);
  }
  const value = Number.parseInt(raw, 10);
  if (value < min || value > max) {
    throw new ConfigError(key, `expected an integer in [${min}, ${max}], got ${value}`);
  }
  return value;
}

/**
 * Derives a Stellar public address from a secret seed.
 *
 * @param secret - The `S...` secret seed.
 * @param field - Variable name, used for error reporting only.
 * @returns The corresponding `G...` public address.
 * @throws {ConfigError} When the seed is not a valid Ed25519 secret seed.
 */
function addressFromSecret(secret: string, field: string): string {
  try {
    return Keypair.fromSecret(secret).publicKey();
  } catch {
    // Deliberately does not echo the value — it is a secret, and it lands in logs.
    throw new ConfigError(field, "not a valid Stellar secret seed (expected a 56-character 'S...' value)");
  }
}

/**
 * Builds a validated facilitator configuration from environment variables.
 *
 * Recognised variables:
 *
 * | Variable                      | Required | Default                             |
 * | ----------------------------- | -------- | ----------------------------------- |
 * | `NETWORK`                     | no       | `stellar:testnet`                   |
 * | `RPC_URL`                     | on pubnet| `https://soroban-testnet.stellar.org` |
 * | `SUBMITTER_SECRET`            | yes      | —                                   |
 * | `FEE_BUMP_SECRET`             | no       | unset                               |
 * | `PORT`                        | no       | `4021`                              |
 * | `FEE_MODE`                    | no       | `free`                              |
 * | `DB_PATH`                     | no       | `./data/catalog.db`                 |
 * | `MAX_TRANSACTION_FEE_STROOPS` | no       | `50000`                             |
 *
 * `SUBMITTER_SECRET` accepts one seed, or a comma-separated list to run several
 * submitter accounts under the package's round-robin selection (DECISIONS D-012).
 * `FACILITATOR_STELLAR_PRIVATE_KEY` is accepted as an alias so an environment set up
 * for the x402 e2e suite (FACTS F-056) works unchanged.
 *
 * @param env - Environment to read (defaults to `process.env`).
 * @returns A fully validated configuration.
 * @throws {ConfigError} On any missing or invalid value.
 */
export function loadConfig(env: Env = process.env): FacilitatorConfig {
  const network = (read(env, "NETWORK") ?? STELLAR_TESTNET_CAIP2) as Network;
  if (!(SUPPORTED_NETWORKS as readonly string[]).includes(network)) {
    throw new ConfigError("NETWORK", `expected one of ${SUPPORTED_NETWORKS.join(", ")}, got '${network}'`);
  }

  const rpcUrlRaw = read(env, "RPC_URL");
  if (network === STELLAR_PUBNET_CAIP2 && rpcUrlRaw === undefined) {
    // FACTS F-004: pubnet has no public default RPC; the package throws if one is missing.
    throw new ConfigError("RPC_URL", `required when NETWORK is ${STELLAR_PUBNET_CAIP2}`);
  }
  const rpcUrl = rpcUrlRaw ?? DEFAULT_RPC_URL;
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("bad protocol");
    }
  } catch {
    throw new ConfigError("RPC_URL", `expected an http(s) URL, got '${rpcUrl}'`);
  }

  const submitterRaw = read(env, "SUBMITTER_SECRET") ?? read(env, "FACILITATOR_STELLAR_PRIVATE_KEY");
  if (submitterRaw === undefined) {
    throw new ConfigError(
      "SUBMITTER_SECRET",
      "required — the account that sources settlement transactions and sponsors their fees",
    );
  }
  const submitterSecrets = submitterRaw
    .split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (submitterSecrets.length === 0) {
    throw new ConfigError("SUBMITTER_SECRET", "required — the value contained no secret seeds");
  }
  const submitterAddresses = submitterSecrets.map(s => addressFromSecret(s, "SUBMITTER_SECRET"));
  if (new Set(submitterAddresses).size !== submitterAddresses.length) {
    throw new ConfigError("SUBMITTER_SECRET", "contains the same account more than once");
  }

  const feeBumpSecret = read(env, "FEE_BUMP_SECRET");
  const feeBumpAddress =
    feeBumpSecret === undefined ? undefined : addressFromSecret(feeBumpSecret, "FEE_BUMP_SECRET");

  const feeModeRaw = read(env, "FEE_MODE") ?? "free";
  if (!(FEE_MODES as readonly string[]).includes(feeModeRaw)) {
    throw new ConfigError(
      "FEE_MODE",
      `expected one of ${FEE_MODES.join(", ")}, got '${feeModeRaw}'`,
    );
  }

  return {
    network,
    rpcUrl,
    submitterSecrets,
    submitterAddresses,
    feeBumpSecret,
    feeBumpAddress,
    port: readInt(env, "PORT", DEFAULT_PORT, 1, 65_535),
    feeMode: feeModeRaw as FeeMode,
    dbPath: read(env, "DB_PATH") ?? DEFAULT_DB_PATH,
    maxTransactionFeeStroops: readInt(
      env,
      "MAX_TRANSACTION_FEE_STROOPS",
      DEFAULT_MAX_TRANSACTION_FEE_STROOPS,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

/**
 * Renders a configuration for logging, with every secret removed.
 *
 * @param config - The configuration to describe.
 * @returns A log-safe projection carrying public addresses but no seeds.
 */
export function describeConfig(config: FacilitatorConfig): Record<string, unknown> {
  return {
    network: config.network,
    rpcUrl: config.rpcUrl,
    submitters: config.submitterAddresses,
    feeBumpAddress: config.feeBumpAddress ?? null,
    port: config.port,
    feeMode: config.feeMode,
    dbPath: config.dbPath,
    maxTransactionFeeStroops: config.maxTransactionFeeStroops,
  };
}
