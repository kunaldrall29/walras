/**
 * Discovery agent — Session 5 acceptance case: an agent that has never seen the
 * seller's docs finds a paid endpoint through the Bazaar and pays it.
 *
 * Flow: GET /discovery/search (spec-shaped, FACTS F-026 … F-028) → pick the
 * top-ranked HTTP listing → build the request from the listing's own
 * `extensions.bazaar.info.input` (the machine-readable calling convention the
 * catalog carries) → pay via the STOCK client path (`@x402/fetch` +
 * `@x402/core` + `@x402/stellar`, unchanged from demo/buyer.ts) → print the
 * settled tx hash, its stellar.expert link, and the fee Horizon actually
 * charged → re-fetch the catalog entry, whose `lastUpdated` this very
 * settlement just bumped (settle-gated cataloging, DECISIONS D-004).
 *
 * Nothing here is protocol code: search is one HTTP GET, and the payment is the
 * same stock wrapper the S2 conformance run proved (EVIDENCE S2-2).
 */
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "http://127.0.0.1:4021";
const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const QUERY = process.env.AGENT_QUERY ?? "current weather in Zurich";
const LIMIT = process.env.AGENT_LIMIT ?? "5";
const secret = process.env.CLIENT_STELLAR_PRIVATE_KEY;

if (!secret) {
  console.error("CLIENT_STELLAR_PRIVATE_KEY is required (the agent's S... seed)");
  process.exit(1);
}

interface Accepts {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

interface Listing {
  resource: string;
  type: string;
  accepts: Accepts[];
  lastUpdated: string;
  description?: string;
  serviceName?: string;
  tags?: string[];
  extensions?: {
    bazaar?: {
      info?: {
        input?: {
          type?: string;
          method?: string;
          queryParams?: Record<string, unknown>;
          bodyType?: string;
          body?: Record<string, unknown>;
        };
      };
    };
  };
}

/** Formats a USDC base-unit amount (7 decimals, FACTS F-008) for humans. */
function usdc(baseUnits: string): string {
  return `${(Number(baseUnits) / 1e7).toFixed(7).replace(/0+$/, "").replace(/\.$/, "")} USDC`;
}

// --- 1. Search the bazaar -------------------------------------------------
const searchUrl = new URL("/discovery/search", FACILITATOR_URL);
searchUrl.searchParams.set("query", QUERY);
searchUrl.searchParams.set("network", "stellar:testnet");
searchUrl.searchParams.set("limit", LIMIT);

console.log(`== agent: searching the bazaar ==`);
console.log(`GET ${searchUrl.toString()}`);

const searchResponse = await fetch(searchUrl);
if (searchResponse.status !== 200) {
  console.error(`search failed: HTTP ${searchResponse.status} ${await searchResponse.text()}`);
  process.exit(1);
}
const search = (await searchResponse.json()) as {
  resources: Listing[];
  partialResults: boolean;
  pagination: { limit: number; cursor: string | null } | null;
};

if (search.resources.length === 0) {
  console.error(`no results for ${JSON.stringify(QUERY)} — is the catalog seeded?`);
  process.exit(1);
}
console.log(
  `${search.resources.length} result(s), partialResults=${search.partialResults}, ranked:`,
);
search.resources.forEach((r, i) => {
  console.log(`  ${i + 1}. ${r.serviceName ?? "(unnamed)"} — ${r.resource}`);
  console.log(`     ${r.description ?? ""}`);
});

// --- 2. Pick the top HTTP result and build the request from its listing ---
const pick = search.resources.find(r => r.type === "http");
if (!pick) {
  console.error("no HTTP-typed result to call");
  process.exit(1);
}
const accepts = pick.accepts[0];
const input = pick.extensions?.bazaar?.info?.input ?? {};
const method = (input.method ?? "GET").toUpperCase();

const target = new URL(pick.resource);
let init: RequestInit = { method };
if (method === "GET" && input.queryParams) {
  for (const [key, value] of Object.entries(input.queryParams)) {
    target.searchParams.set(key, String(value));
  }
} else if (input.body !== undefined) {
  init = {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body),
  };
}

console.log(`\n== agent: paying the top result ==`);
console.log(`picked   : ${pick.serviceName ?? "(unnamed)"} ${pick.resource}`);
console.log(`request  : ${method} ${target.toString()}`);
console.log(`price    : ${accepts.amount} base units = ${usdc(accepts.amount)} on ${accepts.network}`);
console.log(`payTo    : ${accepts.payTo}`);

// --- 3. Pay via the stock client path ------------------------------------
const signer = createEd25519Signer(secret);
const client = new x402Client().register("stellar:*", new ExactStellarScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const httpClient = new x402HTTPClient(client);

// Two attempts: one visible retry absorbs a transient testnet-congestion miss
// (a settle exceeding the stock middleware's timeout re-402s honestly — seen
// live, EVIDENCE S5-5). A second failure is a demo failure.
let response!: Response;
let body: unknown;
let receipt: ReturnType<typeof httpClient.getPaymentSettleResponse> | null = null;
for (let attempt = 1; attempt <= 2; attempt += 1) {
  response = await fetchWithPayment(target.toString(), init);
  body = await response.json();
  receipt = httpClient.getPaymentSettleResponse(name => response.headers.get(name));
  if (response.status === 200 && receipt?.success === true) break;
  console.log(`HTTP ${response.status} — payment did not settle: ${JSON.stringify(receipt ?? null)}`);
  if (attempt === 1) {
    console.log(`retrying once (testnet congestion?)...`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

console.log(`HTTP ${response.status}`);
console.log(`body     : ${JSON.stringify(body)}`);
if (receipt?.success !== true) {
  console.error(`payment did not settle after 2 attempts: ${JSON.stringify(receipt ?? null)}`);
  process.exit(1);
}
console.log(`settled  : tx ${receipt.transaction}`);
console.log(`payer    : ${receipt.payer}`);
console.log(`explorer : https://stellar.expert/explorer/testnet/tx/${receipt.transaction}`);

// --- 4. The fee Horizon actually charged ----------------------------------
interface HorizonTx {
  fee_charged?: string;
  ledger?: number;
  successful?: boolean;
}
let fee: HorizonTx | null = null;
for (let attempt = 0; attempt < 5; attempt += 1) {
  const horizonResponse = await fetch(`${HORIZON_URL}/transactions/${receipt.transaction}`);
  if (horizonResponse.status === 200) {
    fee = (await horizonResponse.json()) as HorizonTx;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
if (fee) {
  console.log(
    `fee      : ${fee.fee_charged} stroops = ${(Number(fee.fee_charged) / 1e7).toFixed(7)} XLM ` +
      `(ledger ${fee.ledger}, successful=${fee.successful})`,
  );
} else {
  console.log(`fee      : (Horizon had not ingested the tx after 5 tries)`);
}

// --- 5. The catalog entry that made this discoverable ---------------------
const listUrl = new URL("/discovery/resources", FACILITATOR_URL);
listUrl.searchParams.set("payTo", accepts.payTo);
const catalog = (await (await fetch(listUrl)).json()) as { items: Listing[] };
const entry = catalog.items.find(item => item.resource === pick.resource);

console.log(`\n== agent: the catalog entry this settlement just refreshed ==`);
if (!entry) {
  console.error(`listing for ${pick.resource} not found after settlement`);
  process.exit(1);
}
// The refresh is asserted, not narrated: settle-gated cataloging means THIS
// settlement must have bumped lastUpdated past the value search returned. A
// silent store fault (DECISIONS D-015/D-025) would leave it stale — that is a
// demo failure, not a PASS.
const seenAtSearch = Date.parse(pick.lastUpdated);
const seenNow = Date.parse(entry.lastUpdated);
if (!(Number.isFinite(seenAtSearch) && Number.isFinite(seenNow) && seenNow > seenAtSearch)) {
  console.error(
    `catalog entry was NOT refreshed by this settlement: lastUpdated ` +
      `${pick.lastUpdated} (at search time) -> ${entry.lastUpdated} (after settling)`,
  );
  process.exit(1);
}
console.log(
  `lastUpdated: ${pick.lastUpdated} (at search time) -> ${entry.lastUpdated} ` +
    `(bumped by this settlement — asserted)`,
);
console.log(JSON.stringify(entry, null, 2));

// Machine-readable trailer for scripts/demo.sh.
console.log(
  `AGENT-REPORT ${JSON.stringify({
    query: QUERY,
    picked: pick.resource,
    transaction: receipt.transaction,
    network: receipt.network,
    payer: receipt.payer,
    feeStroops: fee?.fee_charged ?? null,
    lastUpdated: entry.lastUpdated,
  })}`,
);
