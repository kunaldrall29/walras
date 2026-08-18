import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PaymentRequirements } from "@x402/core/types";
import { decodeCursor, encodeCursor, searchContextHash } from "./cursor.js";
import { Fts5Retriever, type Retriever } from "./retriever.js";
import { extractParamText } from "./searchtext.js";

/**
 * SQLite-backed catalog store for Bazaar discovery listings.
 *
 * Storage engine choice (DECISIONS D-023): Node's built-in `node:sqlite`
 * module — zero added dependencies, no native build, no license surface.
 * Verified working with WAL on the pinned Node v24.14.0 (FACTS F-070);
 * the module is experimental upstream, which D-023 records as an accepted
 * pre-build risk.
 *
 * Keying (FACTS F-029): a listing is identified by the tuple
 * `(resource, type, toolName)`. `toolName` is the empty string for HTTP
 * resources; for MCP tools it is `info.input.toolName`, because MCP
 * multiplexes many tools over one endpoint URL and the spec says facilitators
 * MUST key on both. The reference e2e catalog keys on URL alone and thereby
 * violates this MUST (DECISIONS D-009); walras does not copy that defect.
 *
 * Ownership (DECISIONS D-024): each listing is bound to the verified `payTo`
 * of the settled payment that created it. The check-and-write runs inside one
 * IMMEDIATE transaction so two concurrent settlements cannot race the
 * ownership check.
 *
 * All statements use positional `?` parameters. Timestamps are ISO 8601
 * strings supplied by the caller — the store never reads the clock, so tests
 * are deterministic.
 */

/** Discovery listing as stored, before mapping to the wire shape. */
export interface CatalogListing {
  /** Canonical resource URL: origin + routeTemplate-or-pathname (FACTS F-051). */
  resource: string;
  /** Discriminator from `info.input.type`: "http" or "mcp". */
  type: "http" | "mcp";
  /** MCP tool name; empty string for HTTP resources (FACTS F-029). */
  toolName: string;
  /** Verified payTo that owns this listing (DECISIONS D-024). */
  ownerPayTo: string;
  /** x402 protocol version of the cataloged payload. */
  x402Version: number;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  /** Full echoed `PaymentPayload.extensions` object — carries the bazaar
   * info/schema (input/output schemas and per-parameter descriptions). */
  extensions?: Record<string, unknown>;
  /** Payment options observed across settlements, insertion-ordered. */
  accepts: PaymentRequirements[];
  /** ISO 8601 time of the first settlement that created the listing. */
  firstSettledAt: string;
  /** ISO 8601 time of the most recent settlement touching the listing. */
  lastSettledAt: string;
  /** Number of successful settlements that have touched the listing. */
  settleCount: number;
}

/** Input for a settle-gated upsert. */
/** One field the indexer validated away, for the `soft_drops` audit log. */
export interface SoftDrop {
  /** The listing field that was dropped, e.g. "routeTemplate", "tags". */
  field: string;
  /** Machine-readable reason the field was dropped. */
  reasonCode: string;
}

export interface UpsertInput {
  resource: string;
  type: "http" | "mcp";
  toolName: string;
  payTo: string;
  x402Version: number;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  extensions?: Record<string, unknown>;
  /** The requirements the payment scheme verified and settled against. */
  requirements: PaymentRequirements;
  /** ISO 8601 timestamp for this settlement. */
  settledAt: string;
  /** Per-field soft-drops to record in the audit log (RFP task 3.A). */
  softDrops?: SoftDrop[];
}

/** Result of an upsert attempt. */
export type UpsertResult =
  | { outcome: "created" }
  | { outcome: "updated" }
  /** The listing exists and is owned by a different verified payTo. Nothing was written. */
  | { outcome: "ownership_conflict"; ownerPayTo: string };

/** Filters for listing the catalog — the seven from FACTS F-025 / DECISIONS D-005. */
export interface ListParams {
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  extensions?: string;
  /** Already validated/clamped by the HTTP layer; defaulted here for direct callers. */
  limit?: number;
  offset?: number;
}

/** A page of listings plus the total match count for pagination metadata. */
export interface ListPage {
  items: CatalogListing[];
  limit: number;
  offset: number;
  total: number;
}

/** Spec defaults for list pagination (FACTS F-025). */
export const DEFAULT_LIST_LIMIT = 20;
export const MIN_LIST_LIMIT = 1;
export const MAX_LIST_LIMIT = 100;

/**
 * Parameters for `GET /discovery/search` (FACTS F-026): the required
 * natural-language query, the same five filters as the list endpoint, and the
 * advisory limit/cursor. The spec assigns search no numeric bounds of its own,
 * so `limit` reuses the list defaults (20, clamped 1–100) — DECISIONS D-027.
 */
export interface SearchParams {
  query: string;
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  extensions?: string;
  limit?: number;
  cursor?: string;
}

/** One page of ranked search results. */
export interface SearchPage {
  /** Listings for this page, best match first. */
  resources: CatalogListing[];
  /**
   * True when additional matches were truncated from this response
   * (FACTS F-028): either more ranked matches follow this page, or the
   * retriever hit its retrieval cap and the tail is unknown.
   */
  partialResults: boolean;
  /** Cursor for the next page, or null when this page ends the walk. */
  nextCursor: string | null;
}

/**
 * Retrieval cap: the most candidates the retriever is asked for per search.
 * When the cap is hit, `partialResults` stays true through the last page —
 * the tail beyond the cap is unknown, and claiming completeness would be
 * false (DECISIONS D-027).
 */
export const MAX_SEARCH_RETRIEVE = 1000;

/**
 * How long a statement waits on a locked database before erroring, in
 * milliseconds. Deliberately small: a contended catalog write must fail fast
 * and surface as an indexing error rather than delay a settlement response
 * (DECISIONS D-015 — the budget invariant's only genuinely blocking edge).
 */
const BUSY_TIMEOUT_MS = 100;

/**
 * The catalog schema DDL — exported as the single source `pnpm docs:gen`
 * generates the catalog ERD from (writing rule R3). Runtime behavior is
 * unchanged by the export; `BazaarStore` remains the only writer.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS resources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  resource       TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('http', 'mcp')),
  tool_name      TEXT NOT NULL DEFAULT '',
  owner_pay_to   TEXT NOT NULL,
  x402_version   INTEGER NOT NULL,
  description    TEXT,
  mime_type      TEXT,
  service_name   TEXT,
  tags_json      TEXT,
  icon_url       TEXT,
  extensions_json TEXT,
  first_settled_at TEXT NOT NULL,
  last_settled_at  TEXT NOT NULL,
  settle_count   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (resource, type, tool_name)
);

CREATE TABLE IF NOT EXISTS accepts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id  INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  scheme       TEXT NOT NULL,
  network      TEXT NOT NULL,
  asset        TEXT NOT NULL,
  amount       TEXT NOT NULL,
  pay_to       TEXT NOT NULL,
  max_timeout_seconds INTEGER NOT NULL,
  extra_json   TEXT NOT NULL,
  last_settled_at TEXT NOT NULL,
  UNIQUE (resource_id, scheme, network, asset, amount, pay_to)
);
CREATE INDEX IF NOT EXISTS idx_accepts_resource ON accepts(resource_id);

CREATE TABLE IF NOT EXISTS extension_keys (
  resource_id  INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  UNIQUE (resource_id, key)
);
CREATE INDEX IF NOT EXISTS idx_extension_keys_resource ON extension_keys(resource_id);

CREATE TABLE IF NOT EXISTS soft_drops (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_key  TEXT NOT NULL,
  field        TEXT NOT NULL,
  reason_code  TEXT NOT NULL,
  at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_soft_drops_listing ON soft_drops(listing_key);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(name, description, params, tags);
`;

/** Row shape returned for the resources table (SQLite types only). */
interface ResourceRow {
  id: number | bigint;
  resource: string;
  type: string;
  tool_name: string;
  owner_pay_to: string;
  x402_version: number | bigint;
  description: string | null;
  mime_type: string | null;
  service_name: string | null;
  tags_json: string | null;
  icon_url: string | null;
  extensions_json: string | null;
  first_settled_at: string;
  last_settled_at: string;
  settle_count: number | bigint;
}

/**
 * The catalog store. One instance per process; `DatabaseSync` calls are
 * synchronous and single-connection, so no pooling is involved.
 */
export class BazaarStore {
  private readonly db: DatabaseSync;
  /** Default retriever for `search()`; the BASELINE FTS5/BM25 implementation. */
  private readonly baselineRetriever: Retriever;

  /**
   * Opens (creating if necessary) the catalog database and applies the schema.
   *
   * @param path - Filesystem path for the database, or ":memory:" for tests.
   */
  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    // WAL lets discovery reads proceed while a settlement-hook write is in
    // flight. On :memory: databases SQLite reports journal_mode "memory";
    // that is expected and harmless (FACTS F-070).
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.backfillSearchIndex();
    this.baselineRetriever = new Fts5Retriever(this.db);
  }

  /**
   * Indexes any catalog rows missing from `search_index`.
   *
   * A database created before the search index existed (the Session 3 schema)
   * has listings but no FTS rows; this brings it up to date on open, so the
   * schema upgrade needs no migration step. On an already-current database it
   * selects nothing and writes nothing.
   */
  private backfillSearchIndex(): void {
    const missing = this.db
      .prepare(
        `SELECT id, service_name, description, tags_json, extensions_json
         FROM resources WHERE id NOT IN (SELECT rowid FROM search_index)`,
      )
      .all() as unknown as Array<{
      id: number | bigint;
      service_name: string | null;
      description: string | null;
      tags_json: string | null;
      extensions_json: string | null;
    }>;
    if (missing.length === 0) return;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.db.prepare(
        "INSERT INTO search_index (rowid, name, description, params, tags) VALUES (?, ?, ?, ?, ?)",
      );
      for (const row of missing) {
        insert.run(
          row.id,
          row.service_name ?? "",
          row.description ?? "",
          extractParamText(
            row.extensions_json === null
              ? undefined
              : (JSON.parse(row.extensions_json) as Record<string, unknown>),
          ),
          row.tags_json === null ? "" : (JSON.parse(row.tags_json) as string[]).join(" "),
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The original error matters more.
      }
      throw error;
    }
  }

  /** Closes the underlying database handle. */
  close(): void {
    this.db.close();
  }

  /**
   * Creates or refreshes a listing from a successfully settled payment.
   *
   * The ownership check and every write happen inside a single IMMEDIATE
   * transaction: a payment whose verified payTo differs from the listing
   * owner's cannot create, overwrite, or partially modify the listing
   * (DECISIONS D-024 — the write-poisoning boundary).
   *
   * @param input - The validated, extracted listing data.
   * @returns The upsert outcome; `ownership_conflict` means nothing was written.
   */
  upsertFromSettlement(input: UpsertInput): UpsertResult {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare(
          `SELECT id, owner_pay_to, description, mime_type, service_name,
                  tags_json, icon_url, extensions_json
             FROM resources WHERE resource = ? AND type = ? AND tool_name = ?`,
        )
        .get(input.resource, input.type, input.toolName) as
        | {
            id: number | bigint;
            owner_pay_to: string;
            description: string | null;
            mime_type: string | null;
            service_name: string | null;
            tags_json: string | null;
            icon_url: string | null;
            extensions_json: string | null;
          }
        | undefined;

      if (existing !== undefined && existing.owner_pay_to !== input.payTo) {
        this.db.exec("ROLLBACK");
        return { outcome: "ownership_conflict", ownerPayTo: existing.owner_pay_to };
      }

      // Metadata merge (DECISIONS D-024): a same-owner resettle refreshes only
      // the fields the new payload actually carries; a field the payload omits
      // keeps its prior value. This closes a same-owner poisoning vector — a
      // hostile buyer echoing a stripped-down bazaar extension to a seller's
      // own listing must not be able to BLANK that seller's description /
      // serviceName / tags / iconUrl. `?? existing` never fabricates data;
      // absence means "leave as-is", not "clear".
      const mergedDescription = input.description ?? existing?.description ?? undefined;
      const mergedMimeType = input.mimeType ?? existing?.mime_type ?? undefined;
      const mergedServiceName = input.serviceName ?? existing?.service_name ?? undefined;
      const mergedTags =
        input.tags ??
        (existing?.tags_json != null ? (JSON.parse(existing.tags_json) as string[]) : undefined);
      const mergedIconUrl = input.iconUrl ?? existing?.icon_url ?? undefined;
      const mergedExtensions =
        input.extensions ??
        (existing?.extensions_json != null
          ? (JSON.parse(existing.extensions_json) as Record<string, unknown>)
          : undefined);

      let resourceId: number | bigint;
      if (existing === undefined) {
        const inserted = this.db
          .prepare(
            `INSERT INTO resources
               (resource, type, tool_name, owner_pay_to, x402_version, description,
                mime_type, service_name, tags_json, icon_url, extensions_json,
                first_settled_at, last_settled_at, settle_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .run(
            input.resource,
            input.type,
            input.toolName,
            input.payTo,
            input.x402Version,
            mergedDescription ?? null,
            mergedMimeType ?? null,
            mergedServiceName ?? null,
            mergedTags === undefined ? null : JSON.stringify(mergedTags),
            mergedIconUrl ?? null,
            mergedExtensions === undefined ? null : JSON.stringify(mergedExtensions),
            input.settledAt,
            input.settledAt,
          );
        resourceId = inserted.lastInsertRowid;
      } else {
        resourceId = existing.id;
        this.db
          .prepare(
            `UPDATE resources SET
               x402_version = ?, description = ?, mime_type = ?, service_name = ?,
               tags_json = ?, icon_url = ?, extensions_json = ?,
               last_settled_at = ?, settle_count = settle_count + 1
             WHERE id = ?`,
          )
          .run(
            input.x402Version,
            mergedDescription ?? null,
            mergedMimeType ?? null,
            mergedServiceName ?? null,
            mergedTags === undefined ? null : JSON.stringify(mergedTags),
            mergedIconUrl ?? null,
            mergedExtensions === undefined ? null : JSON.stringify(mergedExtensions),
            input.settledAt,
            resourceId,
          );
        this.db.prepare("DELETE FROM extension_keys WHERE resource_id = ?").run(resourceId);
      }

      const req = input.requirements;
      this.db
        .prepare(
          `INSERT INTO accepts
             (resource_id, scheme, network, asset, amount, pay_to,
              max_timeout_seconds, extra_json, last_settled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (resource_id, scheme, network, asset, amount, pay_to)
           DO UPDATE SET last_settled_at = excluded.last_settled_at,
                         max_timeout_seconds = excluded.max_timeout_seconds,
                         extra_json = excluded.extra_json`,
        )
        .run(
          resourceId,
          req.scheme,
          String(req.network),
          req.asset,
          req.amount,
          req.payTo,
          req.maxTimeoutSeconds,
          JSON.stringify(req.extra ?? {}),
          input.settledAt,
        );

      const insertKey = this.db
        .prepare("INSERT OR IGNORE INTO extension_keys (resource_id, key) VALUES (?, ?)")
        ;
      for (const key of Object.keys(mergedExtensions ?? {})) {
        insertKey.run(resourceId, key);
      }

      // Search index rides the same transaction as the row it describes:
      // either both commit or neither does, so the FTS view of the catalog
      // can never drift from the catalog itself. It indexes the MERGED values,
      // matching exactly what the resources row now stores.
      this.db.prepare("DELETE FROM search_index WHERE rowid = ?").run(resourceId);
      this.db
        .prepare(
          "INSERT INTO search_index (rowid, name, description, params, tags) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          resourceId,
          mergedServiceName ?? "",
          mergedDescription ?? "",
          extractParamText(mergedExtensions),
          mergedTags === undefined ? "" : mergedTags.join(" "),
        );

      // Soft-drop audit log (RFP task 3.A): one row per field the indexer
      // validated away for this settlement, keyed to the listing.
      if (input.softDrops !== undefined && input.softDrops.length > 0) {
        const listingKey = `${input.type}:${input.resource}#${input.toolName}`;
        const insertDrop = this.db.prepare(
          "INSERT INTO soft_drops (listing_key, field, reason_code, at) VALUES (?, ?, ?, ?)",
        );
        for (const drop of input.softDrops) {
          insertDrop.run(listingKey, drop.field, drop.reasonCode, input.settledAt);
        }
      }

      this.db.exec("COMMIT");
      return existing === undefined ? { outcome: "created" } : { outcome: "updated" };
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The transaction may already have unwound; the original error matters more.
      }
      throw error;
    }
  }

  /**
   * Lists catalog entries with the seven spec filters and stable ordering.
   *
   * Filter semantics live on `buildFilterConditions`, shared with `search()`.
   *
   * Ordering is `(resource, tool_name, type, id)` ascending — deterministic
   * and insertion-independent, so offset pagination is stable between pages.
   *
   * @param params - Optional filters and pagination.
   * @returns One page of listings plus the total match count.
   */
  list(params: ListParams = {}): ListPage {
    const limit = clampLimit(params.limit);
    const offset = params.offset !== undefined && params.offset >= 0 ? Math.floor(params.offset) : 0;

    const { where, args } = buildFilterConditions(params);
    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM resources r ${whereSql}`)
      .get(...args) as { total: number | bigint };
    const total = Number(totalRow.total);

    const rows = this.db
      .prepare(
        `SELECT r.* FROM resources r ${whereSql}
         ORDER BY r.resource ASC, r.tool_name ASC, r.type ASC, r.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as unknown as ResourceRow[];

    const items = rows.map(row => this.hydrate(row));
    return { items, limit, offset, total };
  }

  /**
   * Searches the catalog with a natural-language query — `GET /discovery/search`.
   *
   * Pipeline: the retriever ranks up to `MAX_SEARCH_RETRIEVE` catalog rows for
   * the query (BASELINE: FTS5/BM25); the seven-filter semantics of `list()`
   * then intersect that ranking; keyset cursor pagination slices it. The
   * ranking is deterministic (score DESC, id ASC), so under a static catalog a
   * cursor walk visits every match exactly once. `partialResults` is true
   * whenever matches were truncated from this response — a following page
   * exists, or the retrieval cap was hit and the tail is unknown (D-027).
   *
   * @param params - Query, filters, advisory limit, and optional cursor.
   * @param options - Retriever override (eval/tests) and cap override (tests).
   * @returns One ranked page plus continuation state.
   * @throws {InvalidCursorError} When the cursor is malformed or from a
   *   different (query, filters) combination.
   */
  search(
    params: SearchParams,
    options: { retriever?: Retriever; maxRetrieve?: number } = {},
  ): SearchPage {
    const limit = clampLimit(params.limit);
    const retriever = options.retriever ?? this.baselineRetriever;
    const maxRetrieve = options.maxRetrieve ?? MAX_SEARCH_RETRIEVE;
    const contextHash = searchContextHash(params);

    // Decode the cursor before retrieval: a malformed cursor must be a named
    // rejection even when the query happens to match nothing.
    const after = params.cursor === undefined ? undefined : decodeCursor(params.cursor, contextHash);

    const hits = retriever.retrieve(params.query, maxRetrieve);
    const cappedRetrieval = hits.length >= maxRetrieve;
    if (hits.length === 0) {
      return { resources: [], partialResults: false, nextCursor: null };
    }

    const allowed = this.filterResourceIds(
      hits.map(hit => hit.id),
      params,
    );
    const ranked = hits.filter(hit => allowed.has(hit.id));

    // Keyset position: the first hit strictly after (score DESC, id ASC) the
    // cursor row. Linear scan is fine at the retrieval cap's scale.
    let start = 0;
    if (after !== undefined) {
      start = ranked.findIndex(
        hit => hit.score < after.score || (hit.score === after.score && hit.id > after.id),
      );
      if (start === -1) start = ranked.length;
    }

    const page = ranked.slice(start, start + limit);
    const hasMore = start + page.length < ranked.length;
    const last = page[page.length - 1];
    return {
      resources: page.map(hit => this.hydrateById(hit.id)),
      partialResults: hasMore || cappedRetrieval,
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ contextHash, score: last.score, id: last.id })
          : null,
    };
  }

  /**
   * Applies the list-endpoint filter semantics to a set of candidate row ids.
   *
   * @param ids - Candidate `resources.id` values from the retriever.
   * @param params - The filter values (query/limit/cursor fields ignored).
   * @returns The subset of ids whose listings pass every supplied filter.
   */
  private filterResourceIds(ids: number[], params: SearchParams): Set<number> {
    const { where, args } = buildFilterConditions(params);
    if (where.length === 0) {
      // Nothing to filter on; FTS rows and catalog rows are transactionally
      // in sync, so every retrieved id is a live listing.
      return new Set(ids);
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT r.id FROM resources r
         WHERE r.id IN (${placeholders}) AND ${where.join(" AND ")}`,
      )
      .all(...ids, ...args) as unknown as Array<{ id: number | bigint }>;
    return new Set(rows.map(row => Number(row.id)));
  }

  /**
   * Hydrates one listing by row id. The id comes from the search index, which
   * is transactionally consistent with the catalog, so the row must exist.
   *
   * @param id - The `resources.id` value.
   * @returns The hydrated listing.
   */
  private hydrateById(id: number): CatalogListing {
    const row = this.db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as
      | ResourceRow
      | undefined;
    if (row === undefined) {
      throw new Error(`search index row ${id} has no catalog row — index out of sync`);
    }
    return this.hydrate(row);
  }

  /**
   * Fetches one listing by its identity tuple. Test and diagnostic surface.
   *
   * @param resource - Canonical resource URL.
   * @param type - "http" or "mcp".
   * @param toolName - MCP tool name; empty string for HTTP.
   * @returns The listing, or undefined when absent.
   */
  getListing(resource: string, type: string, toolName: string): CatalogListing | undefined {
    const row = this.db
      .prepare("SELECT * FROM resources WHERE resource = ? AND type = ? AND tool_name = ?")
      .get(resource, type, toolName) as ResourceRow | undefined;
    return row === undefined ? undefined : this.hydrate(row);
  }

  /** Total number of listings, unfiltered. */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS total FROM resources").get() as {
      total: number | bigint;
    };
    return Number(row.total);
  }

  /**
   * Reads the soft-drop audit rows for a listing key (RFP task 3.A). The key
   * form matches what `upsertFromSettlement` writes: `${type}:${resource}#${toolName}`.
   *
   * @param listingKey - The composite listing key.
   * @returns The recorded field drops, oldest first.
   */
  softDropsFor(listingKey: string): Array<{ field: string; reasonCode: string; at: string }> {
    return this.db
      .prepare(
        "SELECT field, reason_code AS reasonCode, at FROM soft_drops WHERE listing_key = ? ORDER BY id ASC",
      )
      .all(listingKey) as Array<{ field: string; reasonCode: string; at: string }>;
  }

  /**
   * Builds the soft-drop listing key for a listing, matching the form
   * `upsertFromSettlement` records under.
   *
   * @param resource - Canonical resource URL.
   * @param type - Listing type.
   * @param toolName - MCP tool name, or "" for HTTP.
   * @returns The composite key used in the soft_drops table.
   */
  static softDropKey(resource: string, type: string, toolName: string): string {
    return `${type}:${resource}#${toolName}`;
  }

  /**
   * Builds a full listing from a resources row plus its accepts rows.
   *
   * @param row - The resources table row.
   * @returns The hydrated listing.
   */
  private hydrate(row: ResourceRow): CatalogListing {
    const acceptRows = this.db
      .prepare(
        `SELECT scheme, network, asset, amount, pay_to, max_timeout_seconds, extra_json
         FROM accepts WHERE resource_id = ? ORDER BY id ASC`,
      )
      .all(row.id) as unknown as Array<{
      scheme: string;
      network: string;
      asset: string;
      amount: string;
      pay_to: string;
      max_timeout_seconds: number | bigint;
      extra_json: string;
    }>;

    const accepts: PaymentRequirements[] = acceptRows.map(a => ({
      scheme: a.scheme,
      network: a.network as PaymentRequirements["network"],
      asset: a.asset,
      amount: a.amount,
      payTo: a.pay_to,
      maxTimeoutSeconds: Number(a.max_timeout_seconds),
      extra: JSON.parse(a.extra_json) as Record<string, unknown>,
    }));

    return {
      resource: row.resource,
      type: row.type as "http" | "mcp",
      toolName: row.tool_name,
      ownerPayTo: row.owner_pay_to,
      accepts,
      x402Version: Number(row.x402_version),
      description: row.description ?? undefined,
      mimeType: row.mime_type ?? undefined,
      serviceName: row.service_name ?? undefined,
      tags: row.tags_json === null ? undefined : (JSON.parse(row.tags_json) as string[]),
      iconUrl: row.icon_url ?? undefined,
      extensions:
        row.extensions_json === null
          ? undefined
          : (JSON.parse(row.extensions_json) as Record<string, unknown>),
      firstSettledAt: row.first_settled_at,
      lastSettledAt: row.last_settled_at,
      settleCount: Number(row.settle_count),
    };
  }
}

/**
 * Builds the SQL conditions for the shared discovery filter semantics
 * (FACTS F-025): `type` matches the listing discriminator; `extensions`
 * matches an extension key present on the listing; `payTo`, `scheme`, and
 * `network` must all match within the SAME accepts entry — together they
 * describe one payment option, and a listing should not match
 * `payTo=X&network=Y` merely because X appears on one option and Y on
 * another. Used by both `list()` and `search()` so the two endpoints can
 * never drift apart on what a filter means.
 *
 * @param params - The filter values; other fields are ignored.
 * @returns WHERE fragments (over alias `r`) and their positional arguments.
 */
function buildFilterConditions(params: {
  type?: string;
  payTo?: string;
  scheme?: string;
  network?: string;
  extensions?: string;
}): { where: string[]; args: (string | number)[] } {
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (params.type !== undefined) {
    where.push("r.type = ?");
    args.push(params.type);
  }
  if (params.extensions !== undefined) {
    where.push(
      "EXISTS (SELECT 1 FROM extension_keys ek WHERE ek.resource_id = r.id AND ek.key = ?)",
    );
    args.push(params.extensions);
  }
  const acceptsConds: string[] = [];
  const acceptsArgs: string[] = [];
  if (params.payTo !== undefined) {
    acceptsConds.push("a.pay_to = ?");
    acceptsArgs.push(params.payTo);
  }
  if (params.scheme !== undefined) {
    acceptsConds.push("a.scheme = ?");
    acceptsArgs.push(params.scheme);
  }
  if (params.network !== undefined) {
    acceptsConds.push("a.network = ?");
    acceptsArgs.push(params.network);
  }
  if (acceptsConds.length > 0) {
    where.push(
      `EXISTS (SELECT 1 FROM accepts a WHERE a.resource_id = r.id AND ${acceptsConds.join(" AND ")})`,
    );
    args.push(...acceptsArgs);
  }

  return { where, args };
}

/**
 * Clamps a requested page size to the spec's bounds, applying the default
 * when absent (FACTS F-025: default 20, range 1–100).
 *
 * @param limit - The requested limit, possibly undefined.
 * @returns A limit within [1, 100].
 */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit)) return DEFAULT_LIST_LIMIT;
  const floored = Math.floor(limit);
  if (floored < MIN_LIST_LIMIT) return MIN_LIST_LIMIT;
  if (floored > MAX_LIST_LIMIT) return MAX_LIST_LIMIT;
  return floored;
}
