/**
 * Builds a deliberately short-lived payment payload for the expired-auth-entry
 * negative test — Session 2, Task 5.
 *
 * The payload is produced by the *stock* client path (`x402Client.createPaymentPayload`
 * with the client-side `ExactStellarScheme`), exactly as the buyer demo does. The only
 * liberty taken is the PaymentRequired it is pointed at: `maxTimeoutSeconds` is turned
 * down so the auth entry's `signatureExpirationLedger` lands a few ledgers ahead and
 * the expiry can be waited out in under a minute. Nothing about the payload itself is
 * hand-crafted or tampered with.
 *
 * Prints a JSON report: the spec section 7.1 request body ready to POST, plus the
 * decoded expiry ledger and the ledger at creation time.
 */
import { x402Client } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";
import { Networks, Transaction, xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const secret = process.env.CLIENT_STELLAR_PRIVATE_KEY;
const maxTimeoutSeconds = Number(process.env.NEGATIVE_MAX_TIMEOUT_SECONDS ?? 15);

if (!secret) {
  console.error("CLIENT_STELLAR_PRIVATE_KEY is required");
  process.exit(1);
}

// The PaymentRequired the seller's 402 advertised, with only maxTimeoutSeconds changed.
const paymentRequired = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: "http://127.0.0.1:4030/weather", description: "", mimeType: "" },
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      amount: "100000",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      payTo: "GD7JFO5L4WP7FGRFB33ATR5NJF2FWSC5FTOAKCAYWUMIBMNHFURKNI3R",
      maxTimeoutSeconds,
      extra: { areFeesSponsored: true },
    },
  ],
} as const;

const client = new x402Client().register(
  "stellar:*",
  new ExactStellarScheme(createEd25519Signer(secret)),
);

const rpcServer = new Server(RPC_URL);
const before = await rpcServer.getLatestLedger();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const paymentPayload = await client.createPaymentPayload(paymentRequired as any);

// Decode the auth entry's signatureExpirationLedger from the transaction XDR.
const tx = new Transaction(
  (paymentPayload.payload as { transaction: string }).transaction,
  Networks.TESTNET,
);
const op = tx.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
const expiryLedgers = (op.auth ?? []).map(entry =>
  entry.credentials().address().signatureExpirationLedger(),
);

console.log(
  JSON.stringify(
    {
      createdAtLedger: before.sequence,
      signatureExpirationLedgers: expiryLedgers,
      maxTimeoutSeconds,
      requestBody: {
        x402Version: 2,
        paymentPayload,
        paymentRequirements: paymentRequired.accepts[0],
      },
    },
    null,
    2,
  ),
);
