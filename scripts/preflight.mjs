#!/usr/bin/env node
/**
 * Session gate G1.3 — the submitter account exists and is funded, and RPC is reachable.
 *
 * The facilitator sponsors every settlement fee from the submitter account (FACTS F-006),
 * so an unfunded submitter is not a degraded facilitator, it is a facilitator that cannot
 * settle at all. This checks that precondition before anything is started, and prints a
 * transcript suitable for pasting into docs/EVIDENCE.md.
 *
 * Reads configuration from the repo-root .env. Secrets are never printed.
 *
 *   node scripts/preflight.mjs
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, Horizon, rpc } from "@stellar/stellar-sdk";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(REPO_ROOT, ".env");
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const NETWORK = process.env.NETWORK ?? "stellar:testnet";
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const SUBMITTER =
  process.env.SUBMITTER_SECRET ?? process.env.FACILITATOR_STELLAR_PRIVATE_KEY ?? null;

/** Minimum XLM the submitter should hold to be considered ready to sponsor fees. */
const MIN_XLM = 1;

let failures = 0;

/**
 * Records and prints one gate result.
 *
 * @param {boolean} ok - Whether the check passed.
 * @param {string} label - Short check name.
 * @param {string} detail - Observed value or failure explanation.
 */
function check(ok, label, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(28)} ${detail}`);
}

console.log("== G1.3 preflight ==");
console.log(`network   : ${NETWORK}`);
console.log(`rpc       : ${RPC_URL}`);
console.log(`horizon   : ${HORIZON_URL}`);
console.log("");

if (SUBMITTER === null) {
  check(false, "submitter configured", "SUBMITTER_SECRET is unset in .env");
  process.exit(1);
}

let submitterAddress;
try {
  submitterAddress = Keypair.fromSecret(SUBMITTER.split(",")[0].trim()).publicKey();
  check(true, "submitter secret parses", submitterAddress);
} catch {
  check(false, "submitter secret parses", "not a valid Stellar secret seed");
  process.exit(1);
}

// --- RPC reachability -----------------------------------------------------------------
try {
  const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
  const health = await server.getHealth();
  const ledger = await server.getLatestLedger();
  check(
    health.status === "healthy",
    "rpc reachable",
    `status=${health.status} latestLedger=${ledger.sequence}`,
  );
} catch (error) {
  check(false, "rpc reachable", String(error?.message ?? error));
}

// --- Submitter account state ------------------------------------------------------------
try {
  const horizon = new Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(submitterAddress);
  const native = account.balances.find(b => b.asset_type === "native");
  const xlm = native ? Number.parseFloat(native.balance) : 0;

  check(true, "submitter account exists", `sequence=${account.sequence}`);
  check(xlm >= MIN_XLM, "submitter funded", `${xlm.toFixed(7)} XLM (minimum ${MIN_XLM})`);

  const trustlines = account.balances.filter(b => b.asset_type !== "native");
  // Informational: a fee sponsor holds no payment asset and needs no trustline (F-006).
  console.log(
    `INFO  ${"submitter trustlines".padEnd(28)} ${trustlines.length === 0 ? "none — correct for a fee sponsor" : trustlines.map(t => t.asset_code).join(", ")}`,
  );
} catch (error) {
  const status = error?.response?.status;
  check(
    false,
    "submitter account exists",
    status === 404 ? `not found on ${NETWORK} — fund it with Friendbot` : String(error?.message ?? error),
  );
}

console.log("");
console.log(`GATE G1.3: ${failures === 0 ? "PASS" : `FAIL (${failures} check(s))`}`);
process.exit(failures === 0 ? 0 : 1);
