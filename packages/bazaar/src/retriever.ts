import type { DatabaseSync } from "node:sqlite";

/**
 * Retriever abstraction for `/discovery/search`, plus the pre-build BASELINE
 * implementation.
 *
 * The interface is the seam the funded build upgrades through: the eval
 * harness (`eval/search/`) measures any `Retriever` against the same labeled
 * query set, so a hybrid BM25 + embedding retriever or a re-ranking stage is
 * a drop-in replacement whose gain over this baseline is a number, not a
 * claim (docs/ARCHITECTURE.md §Search ranking upgrade path).
 */

/** One ranked search hit. */
export interface RankedHit {
  /** The catalog row id (`resources.id`). */
  id: number;
  /** Relevance score; HIGHER is better. Comparable only within one result list. */
  score: number;
}

/** Ranks catalog listings against a natural-language query. */
export interface Retriever {
  /**
   * Returns up to `limit` ranked hits for a query, best first.
   *
   * Must be deterministic for a fixed catalog: equal scores are tie-broken by
   * ascending id, so cursor pagination over the ranking is stable.
   *
   * @param query - Raw natural-language query, untrusted.
   * @param limit - Maximum hits to return.
   * @returns Ranked hits, best first; empty when nothing matches.
   */
  retrieve(query: string, limit: number): RankedHit[];
}

/** Maximum query tokens fed to the FTS engine; the rest are ignored. */
export const MAX_QUERY_TOKENS = 32;

/**
 * BM25 column weights for (name, description, params, tags).
 *
 * BASELINE values, chosen by rule of thumb — a name or tag hit says more than
 * a match buried in parameter prose — and NOT tuned against the eval set.
 * Tuning them is exactly the kind of measured change `pnpm eval:search`
 * exists to grade.
 */
export const BM25_WEIGHTS = { name: 4.0, description: 2.0, params: 1.0, tags: 3.0 } as const;

/**
 * Compiles an untrusted natural-language query into a safe FTS5 MATCH
 * expression.
 *
 * FTS5 MATCH has its own query syntax — bare `"`, `(`, `:`, `*`, `NEAR` — and
 * feeding it raw user text throws `fts5: syntax error` (verified live on the
 * pinned Node, EVIDENCE S4-2). So the query is reduced to Unicode
 * letter/number runs, each wrapped in double quotes (a single-term phrase,
 * immune to operator interpretation because quotes cannot appear inside a
 * token), joined with OR. OR rather than AND because natural-language queries
 * carry filler words a conjunction would let veto every result; BM25 still
 * ranks multi-term matches first.
 *
 * @param query - Raw query text, untrusted.
 * @returns The MATCH expression, or undefined when no tokens survive.
 */
export function toFtsMatchExpression(query: string): string | undefined {
  const tokens = query.match(/[\p{L}\p{N}]+/gu)?.slice(0, MAX_QUERY_TOKENS);
  if (tokens === undefined || tokens.length === 0) return undefined;
  return tokens.map(token => `"${token}"`).join(" OR ");
}

/**
 * BASELINE retriever: SQLite FTS5 with BM25 ranking over the `search_index`
 * table (name, description, params, tags) the store maintains.
 *
 * Labeled BASELINE deliberately (DECISIONS D-026): pure lexical matching, no
 * stemming, no synonyms, no embeddings — the pre-build ships the honest floor
 * plus the harness that measures it, and the ranking upgrades are GRANT work.
 * Known consequence, visible in the eval set: vocabulary-mismatch queries
 * ("convert dollars to euros" vs a corpus that says "USD"/"EUR") score zero.
 *
 * `bm25()` returns NEGATIVE scores where smaller means more relevant
 * (verified live, EVIDENCE S4-2); this class negates them so the `Retriever`
 * contract's higher-is-better holds.
 */
export class Fts5Retriever implements Retriever {
  private readonly db: DatabaseSync;

  /**
   * @param db - Open handle to the catalog database that holds `search_index`.
   */
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Ranks catalog rows against the query via FTS5 BM25.
   *
   * @param query - Raw natural-language query, untrusted.
   * @param limit - Maximum hits to return.
   * @returns Ranked hits, best first, ties broken by ascending id.
   */
  retrieve(query: string, limit: number): RankedHit[] {
    const match = toFtsMatchExpression(query);
    if (match === undefined || limit <= 0) return [];
    const rows = this.db
      .prepare(
        `SELECT rowid AS id,
                -bm25(search_index, ${BM25_WEIGHTS.name}, ${BM25_WEIGHTS.description}, ${BM25_WEIGHTS.params}, ${BM25_WEIGHTS.tags}) AS score
         FROM search_index
         WHERE search_index MATCH ?
         ORDER BY score DESC, rowid ASC
         LIMIT ?`,
      )
      .all(match, limit) as unknown as Array<{ id: number | bigint; score: number }>;
    return rows.map(row => ({ id: Number(row.id), score: row.score }));
  }
}
