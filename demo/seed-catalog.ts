/**
 * Catalog seeder — gate G4.1: pays every corpus route once through walras so
 * the discovery catalog is populated the only way walras allows: by real
 * settled payments on stellar:testnet (DECISIONS D-004, settle-gating).
 *
 * The payment path is the stock client, unchanged from demo/buyer.ts: 402
 * handling, payload creation, auth-entry signing, retry, and receipt decoding
 * all live in `@x402/fetch` + `@x402/core` + `@x402/stellar`. This file only
 * loops over the corpus and prints one line per settlement.
 */
import { readFileSync } from "node:fs";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";

const SELLER_ORIGIN = process.env.SELLER_ORIGIN ?? "http://127.0.0.1:4022";
const secret = process.env.CLIENT_STELLAR_PRIVATE_KEY;

if (!secret) {
  console.error("CLIENT_STELLAR_PRIVATE_KEY is required (the buyer's S... seed)");
  process.exit(1);
}

interface CorpusResource {
  id: string;
  method: "GET" | "POST";
  path: string;
  exampleInput: Record<string, unknown>;
  bodyType?: "json";
}

const corpus = JSON.parse(
  readFileSync(new URL("../eval/search/corpus.json", import.meta.url), "utf8"),
) as { resources: CorpusResource[] };

const signer = createEd25519Signer(secret);
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

let failures = 0;
for (const entry of corpus.resources) {
  const url = new URL(entry.path, SELLER_ORIGIN);
  let init: RequestInit;
  if (entry.method === "GET") {
    for (const [key, value] of Object.entries(entry.exampleInput)) {
      url.searchParams.set(key, String(value));
    }
    init = { method: "GET" };
  } else {
    init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry.exampleInput),
    };
  }

  try {
    const response = await fetchWithPayment(url.toString(), init);
    const receipt = httpClient.getPaymentSettleResponse(name => response.headers.get(name));
    console.log(
      JSON.stringify({
        id: entry.id,
        status: response.status,
        transaction: receipt?.success === true ? receipt.transaction : null,
        network: receipt?.network ?? null,
      }),
    );
    if (response.status !== 200 || receipt?.success !== true) failures += 1;
  } catch (error) {
    failures += 1;
    console.log(JSON.stringify({ id: entry.id, error: String(error) }));
  }
}

console.log(`seeded ${corpus.resources.length - failures}/${corpus.resources.length} resources`);
if (failures > 0) process.exit(1);
