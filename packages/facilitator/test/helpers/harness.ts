import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import type { FastifyInstance } from "fastify";
import type { BazaarStore } from "@walras/bazaar";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { loadConfig } from "../../src/config.js";
import { buildServer } from "../../src/server.js";
import { startSorobanRpcDouble, type SorobanRpcDouble } from "./soroban-rpc-double.js";

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "exact-stellar.json");

export interface FixtureCase {
  description: string;
  payload: PaymentPayload;
}

export interface Fixtures {
  network: string;
  networkPassphrase: string;
  baseLedger: number;
  validLedgerOffset: number;
  tooFarLedgerOffset: number;
  accounts: {
    payer: string;
    payTo: string;
    submitter: string;
    submitterSeedPhrase: string;
  };
  asset: { testnetUsdcSac: string; pubnetUsdcSac: string; decimals: number };
  amount: string;
  requirements: PaymentRequirements;
  rpcCapture: {
    capturedFrom: string;
    getLatestLedger: {
      id: string;
      protocolVersion: number;
      sequence: number;
      closeTime: string;
      headerXdr: string;
    };
  };
  cases: Record<string, FixtureCase>;
}

/** The committed fixture set, parsed once per test module. */
export const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixtures;

/**
 * Re-derives the disposable submitter keypair the fixtures were built against.
 *
 * Must stay in lockstep with `scripts/build-fixtures.mjs`; the facilitator-safety fixture
 * only rejects if the running facilitator holds this exact key.
 *
 * @returns The fixture submitter keypair.
 */
export function fixtureSubmitterKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(
    createHash("sha256").update(fixtures.accounts.submitterSeedPhrase).digest(),
  );
}

/**
 * Derives a disposable fee account, for exercising the fee-bump settlement path.
 *
 * Unlike the submitter this address is never baked into a fixture, so it only has to be
 * deterministic and distinct. Also never funded.
 *
 * @returns The fixture fee-bump keypair.
 */
export function fixtureFeeBumpKeypair(): Keypair {
  return Keypair.fromRawEd25519Seed(
    createHash("sha256").update("walras-fixture-fee-bump").digest(),
  );
}

export interface Harness {
  /** The facilitator server, driven through `inject` rather than a real socket. */
  app: FastifyInstance;
  /** The Soroban RPC double backing it. */
  rpc: SorobanRpcDouble;
  /** Tears down both. */
  close: () => Promise<void>;
}

export interface HarnessOptions {
  /** Extra environment overlaid on the defaults before `loadConfig` runs. */
  env?: Record<string, string | undefined>;
  /** Status the RPC double reports for a submitted settlement. */
  transactionStatus?: "SUCCESS" | "FAILED";
  /** Status the RPC double reports for `sendTransaction`. */
  sendStatus?: "PENDING" | "ERROR";
  /** Catalog store injected into the server (e.g. pre-seeded, or broken on purpose). */
  bazaarStore?: BazaarStore;
}

/**
 * Starts a facilitator wired to an in-process Soroban RPC double.
 *
 * Configuration comes from `loadConfig` with an explicit environment rather than
 * `process.env`, so the suite is hermetic: no `.env`, no secrets, no live network beyond
 * the single Horizon estimate call the package makes internally (see `test/setup.ts`).
 *
 * @param options - Harness overrides.
 * @returns The running app, its RPC double, and a teardown function.
 */
export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const rpc = await startSorobanRpcDouble({
    networkPassphrase: fixtures.networkPassphrase,
    latestLedger: fixtures.rpcCapture.getLatestLedger,
    ...(options.transactionStatus ? { transactionStatus: options.transactionStatus } : {}),
    ...(options.sendStatus ? { sendStatus: options.sendStatus } : {}),
  });

  const config = loadConfig({
    NETWORK: fixtures.network,
    RPC_URL: rpc.url,
    SUBMITTER_SECRET: fixtureSubmitterKeypair().secret(),
    PORT: "4021",
    FEE_MODE: "free",
    DB_PATH: ":memory:",
    ...options.env,
  });

  const app = buildServer({
    config,
    ...(options.bazaarStore ? { bazaarStore: options.bazaarStore } : {}),
  });
  await app.ready();

  return {
    app,
    rpc,
    close: async () => {
      await app.close();
      await rpc.close();
    },
  };
}

/**
 * Builds a spec-shaped `/verify` or `/settle` request body.
 *
 * Shape per `specs/x402-specification-v2.md` section 7.1: a top-level `x402Version`
 * alongside `paymentPayload` and `paymentRequirements`.
 *
 * @param payload - The payment payload.
 * @param requirements - The payment requirements; defaults to the fixture set's.
 * @returns The request body.
 */
export function requestBody(
  payload: PaymentPayload,
  requirements: PaymentRequirements = fixtures.requirements,
): Record<string, unknown> {
  return {
    x402Version: payload.x402Version,
    paymentPayload: payload,
    paymentRequirements: requirements,
  };
}
