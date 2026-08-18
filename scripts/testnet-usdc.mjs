/**
 * Funds an account with Circle testnet USDC from its own Friendbot XLM via
 * the Stellar DEX (path payment to self) — no captcha faucet needed.
 *
 * Usage: node scripts/testnet-usdc.mjs <S...secret> [amountUsdc=10]
 *
 * The account must exist (Friendbot-funded). Adds the USDC trustline if
 * missing, then path-pays itself `amountUsdc` USDC with XLM (strict
 * receive, generous sendMax). Testnet USDC/XLM has standing DEX and AMM
 * liquidity, so this is reliable; if it ever thins out, the fallback is
 * the captcha-gated faucet at faucet.circle.com.
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

const secret = process.argv[2];
const amount = process.argv[3] ?? "10";
if (!secret || !/^S[A-Z2-7]{55}$/.test(secret)) {
  console.error("usage: node scripts/testnet-usdc.mjs <S...secret> [amountUsdc]");
  process.exit(2);
}

const server = new Horizon.Server(HORIZON_URL);
const pair = Keypair.fromSecret(secret);
const address = pair.publicKey();

async function submit(buildOps) {
  const account = await server.loadAccount(address);
  const builder = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 10).toString(),
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of buildOps) builder.addOperation(op);
  const tx = builder.setTimeout(60).build();
  tx.sign(pair);
  return server.submitTransaction(tx);
}

const account = await server.loadAccount(address);
const hasTrustline = account.balances.some(
  b => b.asset_code === "USDC" && b.asset_issuer === USDC.getIssuer(),
);
if (!hasTrustline) {
  console.log(`adding USDC trustline to ${address} …`);
  await submit([Operation.changeTrust({ asset: USDC })]);
}

console.log(`buying ${amount} USDC on the testnet DEX (path payment to self) …`);
const result = await submit([
  Operation.pathPaymentStrictReceive({
    sendAsset: Asset.native(),
    sendMax: (Number(amount) * 20).toString(), // generous: up to 20 XLM per USDC
    destination: address,
    destAsset: USDC,
    destAmount: amount,
  }),
]);
console.log(`done — tx ${result.hash}`);
const after = await server.loadAccount(address);
const usdc = after.balances.find(
  b => b.asset_code === "USDC" && b.asset_issuer === USDC.getIssuer(),
);
console.log(`USDC balance of ${address}: ${usdc?.balance ?? "0"}`);
