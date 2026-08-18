# Runbook — operating a walras facilitator

What an operator needs day to day, honest about what exists: everything below
describes behavior as built and cites its FACTS/DECISIONS row or EVIDENCE
transcript; anything not built is marked **PLANNED**. The deployment posture
every figure comes from is `stellar:testnet`, unaudited
([THREAT-MODEL §4](./THREAT-MODEL.md)).

---

## 1. Configuration

The full variable table is generated from the code:
[`reference/config.md`](./reference/config.md). Do not work from copies of it.

Two properties to rely on:

- Invalid configuration exits with code 78 (`EX_CONFIG`) **before a port is
  bound**, naming the offending variable (ARCHITECTURE §3.4). A facilitator that
  starts on half-valid configuration would advertise capability it cannot honour.
- `.env` at the repository root is loaded when present; real environment
  variables win over the file.

## 2. Start, stop, upgrade

**Start**

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/facilitator/dist/index.js     # or: pnpm dev:facilitator
```

Confirm readiness with `GET /health` (operational state, public addresses only)
and `GET /supported` (the kinds and extensions this instance actually serves —
advertised and reachable support must never diverge, D-016).

**Stop** — send `SIGTERM` (`kill <pid>`). The server's Fastify `onClose` hook
closes the catalog store (`packages/facilitator/src/server.ts`). The store is
SQLite in WAL journal mode (D-023), so even an uncoordinated kill is
recoverable: committed transactions are replayed from the WAL on next open.

**Upgrade**

1. `git pull`
2. `pnpm install --frozen-lockfile`
3. `pnpm build`
4. `pnpm test` — require exit 0 before restarting. The suite asserts the
   installed `@x402/stellar` bundle's reason-code set against the enumeration,
   so upstream drift fails the build instead of silently degrading a rejection
   reason (F-063).
5. Restart the process.

**Update-log discipline.** Any upgrade that can affect spec behavior — an
`@x402/*` version bump, a spec re-pin — must update the affected rows in
[`FACTS.md`](./FACTS.md) and [`DECISIONS.md`](./DECISIONS.md) in the same
change. Upstream moved 2.17.0 → 2.20.0 in two days; drift, not inability, is
this project's failure mode (F-061).

## 3. Catalog database: backup and restore

The catalog is one SQLite database at `DB_PATH`, WAL journal mode (D-023).

**Consistent cold backup**

1. Stop the facilitator (SIGTERM, §2).
2. Copy `catalog.db`, `catalog.db-wal`, and `catalog.db-shm` **together**. A
   transaction committed but not yet checkpointed lives only in the `-wal`
   file — copying `catalog.db` alone can lose the most recent listings.
3. Restart.

**Restore** — stop the facilitator, place the copied files back at `DB_PATH`,
start.

**Why back it up at all.** The catalog is rebuildable in principle only by
sellers settling real payments again (D-004) — walras cannot re-create listings
on its own, and there is no registration endpoint to replay (D-022). Treat the
catalog as data worth backing up.

`DB_PATH=:memory:` is test-only; a production instance must use a file path.

## 4. Submitter keys: handling and rotation

- `SUBMITTER_SECRET` accepts a comma-separated list of seeds; multiple
  submitters run under the package's round-robin signer selection (D-012).
- **Rotation without downtime beyond restarts:** add the new seed to the list →
  deploy → confirm the new public address appears in `/supported` `signers` →
  once the old submitter's in-flight settlements have drained, remove its seed →
  deploy again.
- **Keep seeds out of logs.** Redaction is by construction: `/health` and the
  boot log carry only public addresses, and the invalid-seed error omits the
  value (THREAT-MODEL §1). Never paste `.env` into a ticket or a recording.
- `FEE_BUMP_SECRET` names a dedicated fee account: each settlement is wrapped in
  a fee-bump transaction, decoupling fee payment from sequence-number
  management (F-047). The reference operator runs exactly this posture in
  production (F-055), and walras has run it live (EVIDENCE S7-1): fee 23 073
  stroops per settlement, `fee_account ≠ source_account` on Horizon. Running
  without it costs nothing in correctness and saves 100 stroops per settlement
  (D-021) — the fee-bump buys sequence-number isolation, not safety.

## 5. Monitoring signals worth watching

| Signal | Baseline / expectation | Where |
| --- | --- | --- |
| Settle latency | 6–18 s per settlement on testnet; a real 30.5 s congestion outlier is recorded in EVIDENCE S5-5 | facilitator log timestamps |
| RPC errors | any — simulation runs on every `/verify` **and** every `/settle` (F-035, F-036), so RPC health gates the whole payment path | facilitator log |
| Soft-drop rate | `EXTENSION-RESPONSES` `rejected` outcomes plus the indexer's warn logs; a rising rate means hostile or misconfigured clients (D-025) | facilitator log |
| Catalog size | `pagination.total` on `GET /discovery/resources`; nothing prunes stale listings yet (THREAT-MODEL §2) | HTTP |
| Submitter XLM balance | the submitter sponsors 22 973 stroops per settlement on the single-submitter path (F-069), 23 073 on the fee-bump path (F-086); `pnpm preflight` flags a balance under 1 XLM | Horizon / preflight |
| Indexing soft budget | a warn fires when settle-time indexing exceeds its soft 250 ms budget (ARCHITECTURE §4) — it preempts nothing, but repeated warns deserve a look | facilitator log |

## 6. Degraded modes — actual behavior

- **Soroban RPC unreachable:** both `/verify` and `/settle` fail with scheme
  codes, because simulation is mandatory on both paths (F-035, F-036). There is
  **no verify-only degraded mode** — a verify that skipped simulation would
  approve payloads the scheme cannot vouch for.
- **Discovery keeps serving through an RPC outage:** the catalog is local
  SQLite, so `GET /discovery/resources` and `GET /discovery/search` answer
  normally — D-015's payment/discovery separation holds in the read direction
  as well as the write direction.
- **Testnet congestion:** settle can fail honestly after ~30 s — exactly this
  event, with full forensics, is recorded in EVIDENCE S5-5. The stock seller
  middleware re-402s the buyer on `success: false`, so the buyer saw a clean
  payment challenge and no funds moved (EVIDENCE S5-5).
- **Broken catalog store:** settlements are unaffected — the settle response is
  produced from the chain result alone, and a forced-failure test pins
  settlement success against a broken store (D-015). Discovery degrades until
  the store is restored (§3).

## 7. Incident basics

Capture, in order:

1. **The facilitator log** for the window — request timings, indexer warns,
   startup config echo (public addresses only).
2. **The settle request/response bodies**, if any party retained them. Known
   diagnosability gap: walras does not log failed settle response bodies, so the
   exact reason code of a failed settle can go unobserved — recorded in
   EVIDENCE S5-5.
3. **Horizon for the submitter with `include_failed=true`** over the ledger
   range. This distinguishes "failed on-chain" from "never reached the ledger".
4. **Receipt hashes** for settlements that did succeed — each receipt carries
   the 64-hex on-chain hash (F-038), and the ledger is the audit trail.

**Worked example** — the S5-5 congestion incident: one seed settlement returned
`success: false` after 30.5 s. Horizon with `include_failed=true` showed exactly
three submitter transactions in the window, all successful — no failed or
fee-charged fourth transaction existed, ruling out an on-chain failure and
placing the fault at settle-time simulation or submission (EVIDENCE S5-5). The
buyer's balance confirmed no funds moved (EVIDENCE S5-5). Follow the same walk:
count what the chain saw, diff it against what the facilitator attempted, and
the failing layer falls out.

## 8. Hosted operation targets — PLANNED

SLA, paging, and uptime targets for a hosted walras instance are **PLANNED**
(grant scope). Nothing in this repository implements alerting or paging today;
§5 lists the signals an operator wires into their own monitoring in the
meantime.
