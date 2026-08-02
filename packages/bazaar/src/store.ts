import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PaymentRequirements } from "@x402/core/types";

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
 * How long a statement waits on a locked database before erroring, in
 * milliseconds. Deliberately small: a contended catalog write must fail fast
 * and surface as an indexing error rather than delay a settlement response
 * (DECISIONS D-015 — the budget invariant's only genuinely blocking edge).
 */
const BUSY_TIMEOUT_MS = 100;

const SCHEMA_SQL = `
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
          "SELECT id, owner_pay_to FROM resources WHERE resource = ? AND type = ? AND tool_name = ?",
        )
        .get(input.resource, input.type, input.toolName) as
        | { id: number | bigint; owner_pay_to: string }
        | undefined;

      if (existing !== undefined && existing.owner_pay_to !== input.payTo) {
        this.db.exec("ROLLBACK");
        return { outcome: "ownership_conflict", ownerPayTo: existing.owner_pay_to };
      }

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
            input.description ?? null,
            input.mimeType ?? null,
            input.serviceName ?? null,
            input.tags === undefined ? null : JSON.stringify(input.tags),
            input.iconUrl ?? null,
            input.extensions === undefined ? null : JSON.stringify(input.extensions),
            input.settledAt,
            input.settledAt,
          );
        resourceId = inserted.lastInsertRowid;
      } else {
        resourceId = existing.id;
        // Refresh with the latest settlement's view of the resource. The most
        // recent payment a seller demonstrably accepted is the freshest truth
        // about their listing; stale metadata is not preserved.
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
            input.description ?? null,
            input.mimeType ?? null,
            input.serviceName ?? null,
            input.tags === undefined ? null : JSON.stringify(input.tags),
            input.iconUrl ?? null,
            input.extensions === undefined ? null : JSON.stringify(input.extensions),
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
      for (const key of Object.keys(input.extensions ?? {})) {
        insertKey.run(resourceId, key);
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
   * Filter semantics (FACTS F-025): `type` matches the listing discriminator;
   * `extensions` matches an extension key present on the listing; `payTo`,
   * `scheme`, and `network` must all match within the SAME accepts entry —
   * together they describe one payment option, and a listing should not match
   * `payTo=X&network=Y` merely because X appears on one option and Y on
   * another. (Today every listing has a single owner payTo, so the readings
   * coincide; the coherent one costs nothing.)
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
