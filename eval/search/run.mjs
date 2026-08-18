/**
 * Search evaluation harness — `pnpm eval:search`.
 *
 * Measures the catalog's retriever against the labeled query set in
 * queries.json, over a fixture catalog built from corpus.json. This is the
 * measurement method the RFP asks for ("how will you evaluate result quality
 * over time"): any retriever change — BM25 weight tuning today, hybrid
 * embeddings or re-ranking in the funded build — is graded by re-running this
 * command and comparing the emitted numbers, not by eyeballing results.
 *
 * The fixture catalog is built through the REAL indexing path
 * (`indexSettledPayment`): each corpus entry becomes a synthetic settled
 * payment whose extensions come from the stock `declareDiscoveryExtension`,
 * exactly as the live seller produces them. What is synthetic here is only
 * the settlement itself; validation, canonicalization, extraction, and FTS
 * indexing are the production code paths.
 *
 * Metrics (per query, then averaged):
 *  - recall@k  (k = 1, 3, 5): |top-k ∩ relevant| / |relevant|, where a
 *    resource is binary-relevant when its labeled gain >= 2.
 *  - MRR@10: 1 / rank of the first binary-relevant result in the top 10,
 *    0 when none appears.
 *  - nDCG@k (k = 5, 10): DCG@k / IDCG@k with DCG = Σ (2^gain − 1) / log2(i+1)
 *    over the ranked list using the graded gains (unlabeled results gain 0).
 *
 * Output: a table on stdout and eval/search/results/<date>.json.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BazaarStore, BM25_WEIGHTS, indexSettledPayment } from "@walras/bazaar";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const corpusUrl = new URL("./corpus.json", import.meta.url);
const corpusRaw = readFileSync(corpusUrl, "utf8");
const corpus = JSON.parse(corpusRaw);
const { queries } = JSON.parse(readFileSync(new URL("./queries.json", import.meta.url), "utf8"));

/** Fixture constants — shape-valid stand-ins for the settled payment. */
const SELLER = "GD7JFO5L4WP7FGRFB33ATR5NJF2FWSC5FTOAKCAYWUMIBMNHFURKNI3R";
const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const SETTLED_AT = "2026-08-03T00:00:00.000Z";

/**
 * Builds the fixture catalog by replaying every corpus entry through the
 * production indexing path.
 *
 * @returns The populated store plus the resource-URL → corpus-id mapping.
 */
function buildFixtureCatalog() {
  const store = new BazaarStore(":memory:");
  const idByResourceUrl = new Map();

  for (const entry of corpus.resources) {
    const url = `${corpus.origin}${entry.path}`;
    const requirements = {
      scheme: "exact",
      network: "stellar:testnet",
      asset: USDC_TESTNET,
      amount: "100000",
      payTo: SELLER,
      maxTimeoutSeconds: 300,
      extra: { areFeesSponsored: true },
    };
    const payload = {
      x402Version: 2,
      resource: {
        url,
        description: entry.description,
        mimeType: entry.mimeType,
        serviceName: entry.serviceName,
        tags: entry.tags,
      },
      accepted: requirements,
      payload: { transaction: "AAAA" },
      extensions: declareDiscoveryExtension({
        method: entry.method,
        input: entry.exampleInput,
        inputSchema: entry.inputSchema,
        ...(entry.bodyType !== undefined ? { bodyType: entry.bodyType } : {}),
        output: entry.output,
      }),
    };

    const outcome = indexSettledPayment(store, payload, requirements, SETTLED_AT);
    if (outcome.status !== "indexed") {
      throw new Error(
        `corpus entry '${entry.id}' failed to index: ${JSON.stringify(outcome)} — the fixture must go through the same trust boundary as live traffic`,
      );
    }
    idByResourceUrl.set(outcome.resource, entry.id);
  }

  if (store.count() !== corpus.resources.length) {
    throw new Error(`expected ${corpus.resources.length} listings, got ${store.count()}`);
  }
  return { store, idByResourceUrl };
}

/**
 * Discounted cumulative gain at k.
 *
 * @param gains - Gains in rank order.
 * @param k - Cutoff.
 * @returns The DCG value.
 */
function dcgAt(gains, k) {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, gains.length); i += 1) {
    dcg += (2 ** gains[i] - 1) / Math.log2(i + 2);
  }
  return dcg;
}

/**
 * Evaluates one query against the store.
 *
 * @param store - The fixture catalog.
 * @param idByResourceUrl - Resource URL → corpus id.
 * @param labeled - The query with its graded labels.
 * @returns Per-query metrics and the ranked ids.
 */
function evaluateQuery(store, idByResourceUrl, labeled) {
  const page = store.search({ query: labeled.query, limit: 10 });
  const rankedIds = page.resources.map(r => idByResourceUrl.get(r.resource) ?? r.resource);

  const gains = rankedIds.map(id => labeled.relevant[id] ?? 0);
  const relevantSet = Object.entries(labeled.relevant)
    .filter(([, gain]) => gain >= 2)
    .map(([id]) => id);

  const recallAt = k => {
    if (relevantSet.length === 0) return null;
    const hit = rankedIds.slice(0, k).filter(id => relevantSet.includes(id)).length;
    return hit / relevantSet.length;
  };

  const firstRelevantRank = rankedIds.findIndex(id => relevantSet.includes(id));
  const reciprocalRank = firstRelevantRank === -1 ? 0 : 1 / (firstRelevantRank + 1);

  const idealGains = Object.values(labeled.relevant).sort((a, b) => b - a);
  const ndcgAt = k => {
    const ideal = dcgAt(idealGains, k);
    return ideal === 0 ? null : dcgAt(gains, k) / ideal;
  };

  return {
    query: labeled.query,
    rankedIds,
    recall1: recallAt(1),
    recall3: recallAt(3),
    recall5: recallAt(5),
    reciprocalRank,
    ndcg5: ndcgAt(5),
    ndcg10: ndcgAt(10),
  };
}

const { store, idByResourceUrl } = buildFixtureCatalog();
const results = queries.map(labeled => evaluateQuery(store, idByResourceUrl, labeled));
store.close();

const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const aggregate = key => mean(results.map(r => r[key]).filter(v => v !== null));
const aggregates = {
  queries: results.length,
  recallAt1: aggregate("recall1"),
  recallAt3: aggregate("recall3"),
  recallAt5: aggregate("recall5"),
  mrrAt10: aggregate("reciprocalRank"),
  ndcgAt5: aggregate("ndcg5"),
  ndcgAt10: aggregate("ndcg10"),
  zeroResultQueries: results.filter(r => r.rankedIds.length === 0).length,
};

// ---- report ------------------------------------------------------------

const fmt = v => (v === null ? "  — " : v.toFixed(2));
const pad = (s, n) => String(s).padEnd(n);
console.log(
  `\nwalras search eval — retriever: fts5-bm25-baseline (weights ${JSON.stringify(BM25_WEIGHTS)})\n`,
);
console.log(
  `${pad("query", 52)} ${pad("top-1", 17)} R@1  R@3  R@5  RR    nDCG@5`,
);
console.log("-".repeat(100));
for (const r of results) {
  console.log(
    `${pad(r.query.slice(0, 50), 52)} ${pad(r.rankedIds[0] ?? "(no results)", 17)} ` +
      `${fmt(r.recall1)} ${fmt(r.recall3)} ${fmt(r.recall5)} ${fmt(r.reciprocalRank)}  ${fmt(r.ndcg5)}`,
  );
}
console.log("-".repeat(100));
console.log(
  `${pad(`MEAN over ${aggregates.queries} queries (${aggregates.zeroResultQueries} zero-result)`, 70)} ` +
    `${fmt(aggregates.recallAt1)} ${fmt(aggregates.recallAt3)} ${fmt(aggregates.recallAt5)} ` +
    `${fmt(aggregates.mrrAt10)}  ${fmt(aggregates.ndcgAt5)}`,
);
console.log(`nDCG@10: ${fmt(aggregates.ndcgAt10)}\n`);

// ---- persist -----------------------------------------------------------

let gitCommit = "unknown";
try {
  gitCommit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  // A tarball checkout has no git; the result is still valid.
}

const date = new Date().toISOString().slice(0, 10);
const outUrl = new URL(`./results/${date}.json`, import.meta.url);
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
writeFileSync(
  outUrl,
  `${JSON.stringify(
    {
      date,
      gitCommit,
      retriever: "fts5-bm25-baseline",
      bm25Weights: BM25_WEIGHTS,
      corpusSha256: createHash("sha256").update(corpusRaw).digest("hex"),
      corpusResources: corpus.resources.length,
      aggregates,
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`written: eval/search/results/${date}.json`);

// ---- regression gate (`--gate`) ---------------------------------------
//
// Compares this run's nDCG@10 against the committed baseline.json and fails
// on a >5% regression. CI runs `pnpm eval:search --gate`; a retriever change
// that moves the numbers must update baseline.json in the same commit.

if (process.argv.includes("--gate")) {
  const baselineUrl = new URL("./baseline.json", import.meta.url);
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(baselineUrl, "utf8"));
  } catch (error) {
    console.error(`eval gate: cannot read committed baseline at ${baselineUrl.pathname}: ${error}`);
    process.exit(1);
  }
  const floor = baseline.ndcgAt10 * 0.95;
  const current = aggregates.ndcgAt10;
  const delta = ((current - baseline.ndcgAt10) / baseline.ndcgAt10) * 100;
  const corpusChanged = baseline.corpusSha256 !== undefined
    && baseline.corpusSha256 !== createHash("sha256").update(corpusRaw).digest("hex");
  if (corpusChanged) {
    console.error(
      "eval gate: FAIL — corpus.json differs from the one the committed baseline was measured on. " +
        "Re-baseline deliberately (update eval/search/baseline.json in the same commit).",
    );
    process.exit(1);
  }
  if (current < floor) {
    console.error(
      `eval gate: FAIL — nDCG@10 ${current.toFixed(4)} is ${Math.abs(delta).toFixed(1)}% below ` +
        `the committed baseline ${baseline.ndcgAt10.toFixed(4)} (allowed regression: 5%).`,
    );
    process.exit(1);
  }
  console.log(
    `eval gate: PASS — nDCG@10 ${current.toFixed(4)} vs baseline ${baseline.ndcgAt10.toFixed(4)} ` +
      `(${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%).`,
  );
}
