#!/usr/bin/env node
/**
 * walras — testnet account setup (stellar:testnet only).
 *
 * Creates the three accounts the x402 e2e suite expects (FACTS F-056), funds them
 * via Friendbot, and establishes the USDC trustline on the two that need to hold
 * USDC. Prints an .env fragment on stdout; secrets are never written to the repo.
 *
 * Requires @stellar/stellar-sdk ^16 (FACTS F-059, DECISIONS D-013). Until the
 * workspace exists, run it from a scratch dir:
 *
 *   npm init -y && npm i @stellar/stellar-sdk@^16
 *   node setup-accounts.mjs
 *
 * Re-running generates fresh keypairs. To only add a trustline to an existing
 * account, pass its secret:  node setup-accounts.mjs --trustline S...
 *
 * The USDC balance itself cannot be automated: the only documented testnet faucet
 * is captcha-gated (faucet.circle.com, select Stellar). This script prints the one
 * address that needs manual funding.
 */
import {
  Keypair,
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Networks,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
// FACTS F-052: verified on-chain, four independent checks.
const USDC_CODE = "USDC";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

const server = new Horizon.Server(HORIZON);
const usdc = new Asset(USDC_CODE, USDC_ISSUER);

/**
 * Funds an account from Friendbot.
 *
 * @param {string} pub - Public key to fund
 */
async function fund(pub) {
  const res = await fetch(`${FRIENDBOT}/?addr=${encodeURIComponent(pub)}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.hash ?? j.id ?? "(no hash)";
}

/**
 * Establishes the USDC trustline for an account.
 *
 * @param {Keypair} kp - Keypair of the account adding the trustline
 */
async function addTrustline(kp) {
  const account = await server.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

const ROLES = [
  { env: "FACILITATOR_STELLAR_PRIVATE_KEY", role: "facilitator submitter", trustline: false },
  { env: "SERVER_STELLAR_ADDRESS", role: "seller payTo", trustline: true },
  { env: "CLIENT_STELLAR_PRIVATE_KEY", role: "buyer agent", trustline: true, needsUsdc: true },
];

console.log("walras testnet account setup — stellar:testnet");
console.log(`USDC ${USDC_CODE}:${USDC_ISSUER}`);
console.log(`SAC  ${USDC_SAC}\n`);

const out = [];
for (const r of ROLES) {
  const kp = Keypair.random();
  const fundHash = await fund(kp.publicKey());
  let trustHash = null;
  if (r.trustline) trustHash = await addTrustline(kp);
  out.push({ ...r, pub: kp.publicKey(), secret: kp.secret(), fundHash, trustHash });
  console.log(`${r.role.padEnd(22)} ${kp.publicKey()}`);
  console.log(`${"".padEnd(22)} funded ${fundHash}`);
  if (trustHash) console.log(`${"".padEnd(22)} trustline ${trustHash}`);
}

console.log("\n--- .env fragment (DO NOT COMMIT) ---");
console.log("NETWORK=stellar:testnet");
console.log("RPC_URL=https://soroban-testnet.stellar.org");
console.log(`USDC_CONTRACT_ID=${USDC_SAC}`);
for (const o of out) {
  console.log(`${o.env}=${o.env.endsWith("ADDRESS") ? o.pub : o.secret}`);
  // SUBMITTER_SECRET is the canonical facilitator variable and is preferred over
  // the e2e-suite alias everywhere — print it too, so a pasted fragment never
  // loses to a stale SUBMITTER_SECRET line above it.
  if (o.env === "FACILITATOR_STELLAR_PRIVATE_KEY") console.log(`SUBMITTER_SECRET=${o.secret}`);
  if (o.env.endsWith("ADDRESS")) console.log(`SELLER_SECRET=${o.secret}`);
}

const buyer = out.find(o => o.needsUsdc);
console.log(`\n>>> FUND THIS ADDRESS WITH TESTNET USDC (faucet.circle.com, select Stellar):`);
console.log(`>>> ${buyer.pub}`);
