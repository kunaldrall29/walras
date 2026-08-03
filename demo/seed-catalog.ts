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

// SEED_IDS narrows the run to a comma-separated subset of corpus ids; unset or
// empty seeds all. scripts/demo.sh uses this to stage the first "auto-listed"
// payment separately. Duplicates are collapsed; unknown ids are a hard error.
const rawSeedIds = process.env.SEED_IDS;
let seedIds: string[] | undefined;
if (rawSeedIds !== undefined && rawSeedIds.trim() !== "") {
  seedIds = [...new Set(rawSeedIds.split(",").map(s => s.trim()).filter(Boolean))];
  if (seedIds.length === 0) {
    console.error(`SEED_IDS is set but contains no ids: ${JSON.stringify(rawSeedIds)}`);
    process.exit(1);
  }
  const known = new Set(corpus.resources.map(r => r.id));
  const unknown = seedIds.filter(id => !known.has(id));
  if (unknown.length > 0) {
    console.error(`SEED_IDS contains unknown ids: ${unknown.join(", ")}`);
    process.exit(1);
  }
}
const resources = seedIds
  ? corpus.resources.filter(r => (seedIds as string[]).includes(r.id))
  : corpus.resources;

const signer = createEd25519Signer(secret);
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

let failures = 0;
for (const entry of resources) {
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

  // Two attempts per resource: testnet inclusion can transiently exceed the
  // stock middleware's facilitator-client timeout (observed live: a 30.5 s
  // settle under congestion, EVIDENCE S5-5), and one visible retry keeps a
  // single slow ledger from killing the whole demo. Both attempts are printed;
  // a second failure still fails the run.
  let settled = false;
  for (let attempt = 1; attempt <= 2 && !settled; attempt += 1) {
    try {
      const response = await fetchWithPayment(url.toString(), init);
      const receipt = httpClient.getPaymentSettleResponse(name => response.headers.get(name));
      settled = response.status === 200 && receipt?.success === true;
      console.log(
        JSON.stringify({
          id: entry.id,
          ...(attempt > 1 ? { attempt } : {}),
          status: response.status,
          transaction: settled && receipt?.success === true ? receipt.transaction : null,
          network: receipt?.network ?? null,
        }),
      );
    } catch (error) {
      console.log(JSON.stringify({ id: entry.id, ...(attempt > 1 ? { attempt } : {}), error: String(error) }));
    }
    if (!settled && attempt === 1) {
      console.log(JSON.stringify({ id: entry.id, retrying: "payment did not settle (testnet congestion?) — one retry" }));
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  if (!settled) failures += 1;
}

console.log(`seeded ${resources.length - failures}/${resources.length} resources`);
if (failures > 0) process.exit(1);
