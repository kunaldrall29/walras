/**
 * Stock x402 buyer — Session 2 acceptance case, buyer half.
 *
 * Zero custom protocol code, by construction: the 402 handling, payload creation,
 * auth-entry signing, retry with `X-PAYMENT`, and receipt decoding are all inside
 * `@x402/fetch`, `@x402/core`, and `@x402/stellar`. This file supplies a key, a URL,
 * and prints what came back. The wiring below is line-for-line the Stellar subset of
 * the x402 repo's own e2e fetch client (`e2e/clients/fetch/index.ts` @ pinned SHA).
 */
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";

// Default: the seller directly. The transcript capture in EVIDENCE S2-2 overrides this
// to the tap (:4030) so the exchange is recorded on the wire.
const url = process.env.RESOURCE_URL ?? "http://127.0.0.1:4022/weather";
const secret = process.env.CLIENT_STELLAR_PRIVATE_KEY;

if (!secret) {
  console.error("CLIENT_STELLAR_PRIVATE_KEY is required (the buyer's S... seed)");
  process.exit(1);
}

const signer = createEd25519Signer(secret);
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));

const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

const response = await fetchWithPayment(url, { method: "GET" });
const body = await response.json();
const receipt = httpClient.getPaymentSettleResponse(name => response.headers.get(name));

console.log(
  JSON.stringify({ status: response.status, body, paymentResponse: receipt ?? null }, null, 2),
);
