#!/usr/bin/env node
/**
 * Generates the `exact` / `stellar:testnet` payment-payload fixtures the facilitator
 * unit tests run against.
 *
 * Provenance, stated plainly: Session 0 could not capture a real signed payload. A stock
 * client cannot build one without a buyer holding testnet USDC, and the only documented
 * faucet is captcha-gated, which is why FACTS Q-011 is still OPEN. What Session 0 *did*
 * establish is everything these fixtures are built from — the three testnet accounts
 * (EVIDENCE "Accounts"), the USDC SAC verified four independent ways (F-052), the payload
 * shape (F-033), and the auth-entry expiry rule (F-034).
 *
 * So the transactions here are synthesized, not captured: real keys, real Ed25519
 * signatures over the real CAP-46 authorization preimage, real XDR — assembled locally
 * rather than observed on the wire. Every signature verifies; none of these transactions
 * has been submitted to a network.
 *
 * Secrets are read from the repo-root .env and never written to the output.
 *
 *   node scripts/build-fixtures.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(REPO_ROOT, ".env");
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const OUT_DIR = join(REPO_ROOT, "packages", "facilitator", "test", "fixtures");
const OUT_FILE = join(OUT_DIR, "exact-stellar.json");

const NETWORK = "stellar:testnet";
const PASSPHRASE = Networks.TESTNET;
const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";

/** Testnet USDC SAC — FACTS F-052, verified on-chain four independent ways. */
const USDC_SAC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
/** Pubnet USDC SAC — used only as an unmistakably wrong asset (FACTS F-053). */
const WRONG_SAC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

/** 0.01 USDC at 7 decimals — the same amount as the real settlement decoded in EVIDENCE S0-4. */
const AMOUNT = 100_000n;

/**
 * Auth-entry lifetime for the valid fixture, in ledgers.
 *
 * `maxTimeoutSeconds: 60` at testnet's ~5 s close time gives a 12-ledger window
 * (FACTS F-034), and the package tolerates 2 more (F-046, DECISIONS D-008). 8 sits
 * comfortably inside that, and inside the window for any close-time estimate up to 10 s
 * — so the fixture stays valid regardless of what the one live Horizon call the package
 * makes for its estimate happens to return.
 */
const VALID_LEDGER_OFFSET = 8;

/** Far outside any plausible window, for the expiry-bound rejection case. */
const TOO_FAR_LEDGER_OFFSET = 5_000;

const MAX_TIMEOUT_SECONDS = 60;

const buyerSecret = process.env.CLIENT_STELLAR_PRIVATE_KEY;
const sellerAddress = process.env.SERVER_STELLAR_ADDRESS;

for (const [name, value] of Object.entries({
  CLIENT_STELLAR_PRIVATE_KEY: buyerSecret,
  SERVER_STELLAR_ADDRESS: sellerAddress,
})) {
  if (!value) {
    console.error(`build-fixtures: ${name} is not set in ${ENV_FILE}`);
    process.exit(1);
  }
}

const buyer = Keypair.fromSecret(buyerSecret);

/**
 * Seed phrase for the throwaway submitter identity the fixtures are built against.
 *
 * Deliberately *not* the real Session 0 submitter. The facilitator-safety fixture needs
 * the facilitator's own address baked into a transaction, and the tests need to configure
 * a facilitator holding the matching key — which would make the whole suite depend on a
 * gitignored secret and refuse to run in CI. Deriving a disposable account from a fixed
 * string keeps the fixtures and the tests in agreement with nothing secret in between.
 * This account is never funded and never appears on-chain.
 */
const FIXTURE_SUBMITTER_SEED_PHRASE = "walras-fixture-submitter";
const submitter = Keypair.fromRawEd25519Seed(
  createHash("sha256").update(FIXTURE_SUBMITTER_SEED_PHRASE).digest(),
);

/**
 * Issues a raw JSON-RPC call against the Soroban RPC endpoint.
 *
 * Deliberately raw rather than via `rpc.Server`: the point is to capture the wire
 * responses verbatim so the test double can replay them, not to consume parsed objects.
 *
 * @param method - JSON-RPC method name.
 * @param params - Method parameters.
 * @returns The `result` member of the response.
 */
async function rpcCall(method, params) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

// Captured live so the test double replays a real wire response rather than an invented
// one. The ledger height recorded here is what makes the expiry cases deterministic.
let latestLedger;
try {
  latestLedger = await rpcCall("getLatestLedger");
} catch (error) {
  console.error(`build-fixtures: RPC capture from ${RPC_URL} failed: ${error.message}`);
  process.exit(1);
}
const baseLedger = latestLedger.sequence;

let nonceCounter = 0;
/**
 * Produces a distinct auth-entry nonce per fixture.
 *
 * On-chain these must be unpredictable, because nonce consumption is what makes replay
 * fail (DECISIONS D-011). These transactions are never submitted, so a counter keeps
 * regenerated fixtures diffable.
 *
 * @returns An XDR Int64 nonce.
 */
function nextNonce() {
  nonceCounter += 1;
  return xdr.Int64.fromString(String(9_000_000_000 + nonceCounter));
}

/**
 * Builds the `transfer(from, to, amount)` contract-invocation arguments.
 *
 * @param options - Invocation parameters.
 * @param options.asset - Token contract address to invoke.
 * @param options.from - Payer address.
 * @param options.to - Recipient address.
 * @param options.amount - Amount in base units.
 * @returns The XDR invoke-contract arguments.
 */
function invokeArgs({ asset, from, to, amount }) {
  return new xdr.InvokeContractArgs({
    contractAddress: new Address(asset).toScAddress(),
    functionName: "transfer",
    args: [
      nativeToScVal(Address.fromString(from), { type: "address" }),
      nativeToScVal(Address.fromString(to), { type: "address" }),
      nativeToScVal(amount, { type: "i128" }),
    ],
  });
}

/**
 * Builds an authorization entry for a contract invocation, optionally with sub-invocations.
 *
 * @param options - Entry parameters.
 * @param options.args - The invoke-contract arguments being authorized.
 * @param options.signerAddress - Address whose authorization this entry represents.
 * @param options.subInvocations - Nested invocations to authorize as well.
 * @returns An unsigned authorization entry using address credentials.
 */
function unsignedAuthEntry({ args, signerAddress, subInvocations = [] }) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(signerAddress).toScAddress(),
        nonce: nextNonce(),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
      subInvocations,
    }),
  });
}

/**
 * Assembles a single-operation `invokeHostFunction` transaction sourced by the payer.
 *
 * The client is the transaction source here, never the facilitator — the facilitator
 * rebuilds with its own source at settle time, and a client-supplied facilitator source
 * is an explicit MUST NOT (spec section 4, Facilitator Safety).
 *
 * @param options - Transaction parameters.
 * @param options.source - Transaction source account address.
 * @param options.args - The invoke-contract arguments.
 * @param options.auth - Authorization entries to attach.
 * @returns Base64 transaction XDR.
 */
function buildTransactionXdr({ source, args, auth }) {
  const operation = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(args),
    auth,
  });
  return new TransactionBuilder(new Account(source, "0"), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build()
    .toXDR();
}

/**
 * Builds a signed single-transfer transaction.
 *
 * @param options - Transfer parameters.
 * @param options.asset - Token contract address.
 * @param options.from - Payer address.
 * @param options.to - Recipient address.
 * @param options.amount - Amount in base units.
 * @param options.signer - Keypair signing the authorization entry.
 * @param options.expirationLedger - Auth-entry signature expiration ledger.
 * @param options.subInvocations - Optional nested invocations to authorize.
 * @param options.source - Transaction source account; defaults to the payer.
 * @returns Base64 transaction XDR with a signed auth entry.
 */
async function signedTransfer({
  asset = USDC_SAC,
  from = buyer.publicKey(),
  to = sellerAddress,
  amount = AMOUNT,
  signer = buyer,
  expirationLedger = baseLedger + VALID_LEDGER_OFFSET,
  subInvocations = [],
  source = undefined,
}) {
  const args = invokeArgs({ asset, from, to, amount });
  const entry = unsignedAuthEntry({ args, signerAddress: from, subInvocations });
  const signed = await authorizeEntry(entry, signer, expirationLedger, PASSPHRASE);
  return buildTransactionXdr({ source: source ?? from, args, auth: [signed] });
}

/**
 * Flips one bit of the Ed25519 signature inside a transaction's first auth entry.
 *
 * The result is structurally perfect and passes every check the facilitator package
 * performs on its own — `gatherAuthEntrySignatureStatus` only asks whether a signature is
 * present, not whether it verifies. Catching this is the Soroban host's job during
 * simulation, which is exactly why simulation success is itself a spec MUST (FACTS F-035).
 *
 * @param txXdr - Base64 transaction XDR to tamper with.
 * @returns Base64 transaction XDR carrying an invalid signature.
 */
function tamperAuthSignature(txXdr) {
  const envelope = xdr.TransactionEnvelope.fromXDR(txXdr, "base64");
  const operation = envelope.v1().tx().operations()[0];
  const entry = operation.body().invokeHostFunctionOp().auth()[0];
  const signatureVec = entry.credentials().address().signature().vec();
  const signatureMap = signatureVec[0].map();

  for (const kv of signatureMap) {
    if (kv.key().sym().toString() === "signature") {
      const bytes = Buffer.from(kv.val().bytes());
      bytes[0] ^= 0x01;
      kv.val(xdr.ScVal.scvBytes(bytes));
    }
  }
  return envelope.toXDR("base64");
}

/**
 * Wraps a transaction XDR in a full x402 v2 `PaymentPayload`.
 *
 * Shape is verbatim from `specs/schemes/exact/scheme_exact_stellar.md` (FACTS F-033).
 *
 * @param txXdr - Base64 transaction XDR, or any string for the malformed case.
 * @param overrides - Fields to override on the payload, for negative cases.
 * @returns A complete PaymentPayload object.
 */
function paymentPayload(txXdr, overrides = {}) {
  return {
    x402Version: 2,
    resource: {
      url: "https://example.walras.test/weather",
      description: "Access to protected content",
      mimeType: "application/json",
    },
    accepted: requirements,
    payload: { transaction: txXdr },
    ...overrides,
  };
}

const requirements = {
  scheme: "exact",
  network: NETWORK,
  amount: AMOUNT.toString(),
  asset: USDC_SAC,
  payTo: sellerAddress,
  maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
  extra: { areFeesSponsored: true },
};

const cases = {};

cases.valid = {
  description:
    "Correct asset, recipient, and amount; auth entry signed by the payer and expiring 8 ledgers out.",
  payload: paymentPayload(await signedTransfer({})),
};

cases.tamperedAuthSignature = {
  description:
    "The valid transaction with one bit of the payer's Ed25519 signature flipped. Structurally intact; the signature no longer verifies against the CAP-46 authorization preimage.",
  payload: paymentPayload(tamperAuthSignature(cases.valid.payload.payload.transaction)),
};

{
  const args = invokeArgs({
    asset: USDC_SAC,
    from: buyer.publicKey(),
    to: sellerAddress,
    amount: AMOUNT,
  });
  cases.unsignedAuthEntry = {
    description: "Auth entry present but never signed — its signature field is still scvVoid.",
    payload: paymentPayload(
      buildTransactionXdr({
        source: buyer.publicKey(),
        args,
        auth: [unsignedAuthEntry({ args, signerAddress: buyer.publicKey() })],
      }),
    ),
  };
}

cases.expirationTooFar = {
  description: `Auth entry expiring ${TOO_FAR_LEDGER_OFFSET} ledgers out, far beyond currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds).`,
  payload: paymentPayload(
    await signedTransfer({ expirationLedger: baseLedger + TOO_FAR_LEDGER_OFFSET }),
  ),
};

cases.wrongAmount = {
  description: "Transfers one base unit less than paymentRequirements.amount.",
  payload: paymentPayload(await signedTransfer({ amount: AMOUNT - 1n })),
};

cases.wrongAsset = {
  description: "Invokes the pubnet USDC contract while the requirements name the testnet SAC.",
  payload: paymentPayload(await signedTransfer({ asset: WRONG_SAC })),
};

cases.wrongRecipient = {
  description: "Pays the buyer's own address instead of paymentRequirements.payTo.",
  payload: paymentPayload(await signedTransfer({ to: buyer.publicKey() })),
};

cases.facilitatorIsTxSource = {
  description:
    "Client-supplied transaction source is the facilitator's own account (spec section 4, Facilitator Safety, first bullet).",
  payload: paymentPayload(await signedTransfer({ source: submitter.publicKey() })),
};

cases.facilitatorIsPayer = {
  description:
    "Transaction sourced by the buyer, but the transfer debits the facilitator's account — an attempt to spend the fee sponsor's own funds (spec section 4, Facilitator Safety, third bullet).",
  payload: paymentPayload(
    await signedTransfer({
      from: submitter.publicKey(),
      signer: submitter,
      source: buyer.publicKey(),
    }),
  ),
};

{
  const args = invokeArgs({
    asset: USDC_SAC,
    from: buyer.publicKey(),
    to: sellerAddress,
    amount: AMOUNT,
  });
  const nested = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      invokeArgs({
        asset: USDC_SAC,
        from: buyer.publicKey(),
        to: submitter.publicKey(),
        amount: AMOUNT * 10n,
      }),
    ),
    subInvocations: [],
  });
  cases.hasSubInvocations = {
    description:
      "Auth entry authorizes a second, larger transfer as a sub-invocation alongside the expected one.",
    payload: paymentPayload(
      buildTransactionXdr({
        source: buyer.publicKey(),
        args,
        auth: [
          await authorizeEntry(
            unsignedAuthEntry({ args, signerAddress: buyer.publicKey(), subInvocations: [nested] }),
            buyer,
            baseLedger + VALID_LEDGER_OFFSET,
            PASSPHRASE,
          ),
        ],
      }),
    ),
  };

  cases.noAuthEntries = {
    description: "invokeHostFunction operation carrying no authorization entries at all.",
    payload: paymentPayload(buildTransactionXdr({ source: buyer.publicKey(), args, auth: [] })),
  };
}

{
  const paymentTx = new TransactionBuilder(new Account(buyer.publicKey(), "0"), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: sellerAddress,
        asset: Asset.native(),
        amount: "0.0100000",
      }),
    )
    .setTimeout(180)
    .build();
  cases.wrongOperation = {
    description:
      "A classic payment operation instead of invokeHostFunction. Classic assets are out of scope for this scheme (FACTS F-033).",
    payload: paymentPayload(paymentTx.toXDR()),
  };
}

cases.malformedTransaction = {
  description: "payload.transaction is not decodable as transaction XDR.",
  payload: paymentPayload("this-is-not-transaction-xdr"),
};

const fixture = {
  $comment:
    "Generated by scripts/build-fixtures.mjs. Synthesized from the Session 0 accounts and asset, not captured from a live client — see the script header and FACTS Q-011.",
  generator: "scripts/build-fixtures.mjs",
  network: NETWORK,
  networkPassphrase: PASSPHRASE,
  baseLedger,
  validLedgerOffset: VALID_LEDGER_OFFSET,
  tooFarLedgerOffset: TOO_FAR_LEDGER_OFFSET,
  accounts: {
    // Real Session 0 testnet accounts (EVIDENCE "Accounts").
    payer: buyer.publicKey(),
    payTo: sellerAddress,
    // Disposable, derived from a fixed phrase so tests need no secret. Never funded.
    submitter: submitter.publicKey(),
    submitterSeedPhrase: FIXTURE_SUBMITTER_SEED_PHRASE,
  },
  asset: { testnetUsdcSac: USDC_SAC, pubnetUsdcSac: WRONG_SAC, decimals: 7 },
  amount: AMOUNT.toString(),
  requirements,
  // A real wire response, captured once so the test double replays observed RPC output
  // rather than invented output. `metadataXdr` is deliberately dropped: it is ~124 KB of
  // ledger close meta that nothing on the payment path reads, so the double synthesizes a
  // minimal stand-in from the header below.
  rpcCapture: {
    capturedFrom: RPC_URL,
    getLatestLedger: {
      id: latestLedger.id,
      protocolVersion: latestLedger.protocolVersion,
      sequence: latestLedger.sequence,
      closeTime: latestLedger.closeTime,
      headerXdr: latestLedger.headerXdr,
    },
  },
  cases,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(fixture, null, 2)}\n`);

console.log(`wrote ${OUT_FILE}`);
console.log(`base ledger : ${baseLedger}`);
console.log(`payer       : ${buyer.publicKey()}`);
console.log(`payTo       : ${sellerAddress}`);
console.log(`submitter   : ${submitter.publicKey()}`);
console.log(`cases       : ${Object.keys(cases).length}`);
for (const [name, value] of Object.entries(cases)) {
  console.log(`  ${name.padEnd(24)} tx ${String(value.payload.payload.transaction).length} chars`);
}
