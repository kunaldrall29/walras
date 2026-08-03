# ARCHITECTURE — walras

How the repository is laid out and why the pieces are split the way they are.

Every design claim here cites a row in [`FACTS.md`](./FACTS.md) or an entry in
[`DECISIONS.md`](./DECISIONS.md). Pinned spec commit:
`x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`.

> **Note on this file.** It did not exist when Session 1 began — the session brief referred
> to it as the source of the repo layout. It was written during Session 1 to record the
> layout actually built, so the reference resolves from here on. Sections describing
> packages that do not exist yet are marked **(not built)** and are a plan, not a claim.

---

## 1. Shape of the repository

```
walras/
├── docs/                        # FACTS, DECISIONS, EVIDENCE, rfp, this file
├── packages/
│   ├── facilitator/             # x402 facilitator over stellar:testnet   ← built (S1–S4)
│   │   ├── src/
│   │   │   ├── config.ts        # environment surface, validated at boot
│   │   │   ├── errors.ts        # the two reason-code taxonomies
│   │   │   ├── facilitator.ts   # config -> ExactStellarScheme -> x402Facilitator
│   │   │   ├── server.ts        # Fastify app: /verify, /settle, /supported,
│   │   │   │                    #   /discovery/resources, /discovery/search, /health
│   │   │   └── index.ts         # boot: load env, build, listen
│   │   └── test/
│   │       ├── fixtures/        # generated payment payloads (see §5)
│   │       └── helpers/         # Soroban RPC double, test harness
│   └── bazaar/                  # settle-gated discovery catalog          ← built (S3–S4)
│       └── src/
│           ├── store.ts         # SQLite (WAL, node:sqlite) persistence + search
│           ├── indexer.ts       # the trust boundary for hostile extension payloads
│           ├── retriever.ts     # Retriever seam + BASELINE FTS5/BM25 impl (see §7)
│           ├── searchtext.ts    # param names + schema descriptions -> search text
│           ├── cursor.ts        # opaque keyset cursor for /discovery/search
│           ├── reasons.ts       # bazaar_* soft-drop codes
│           └── wire.ts          # DiscoveryResource mapping, EXTENSION-RESPONSES
├── demo/                        # stock seller + buyer + hostile client (S2–S4)
├── eval/
│   └── search/                  # labeled queries + metrics harness (see §7.2)
├── scripts/
│   ├── setup-accounts.mjs       # one-shot testnet account creation (Session 0)
│   ├── preflight.mjs            # gate G1.3: submitter funded, RPC reachable
│   ├── build-fixtures.mjs       # regenerates the payload fixtures
│   ├── license-scan.mjs         # gate G-LIC
│   └── check-single-stellar-sdk.mjs  # DECISIONS D-013
├── pnpm-workspace.yaml
└── tsconfig.base.json           # strict TypeScript, shared by every package
```

Planned, **not built**: `packages/mcp` (MCP surface over the catalog — S5/proposal scope).

The split is along the seam the spec itself draws. `bazaar.md` says storing, indexing, and
exposing discovered resources is "an implementation detail" of the facilitator
(FACTS F-023) — so discovery lives in `packages/bazaar`, a transport-free library the
facilitator mounts; the facilitator remains a payment component whose only catalog
knowledge is the settle-success hook and two GET routes.

## 2. Toolchain

Pinned per FACTS F-058 / F-059 and DECISIONS D-013.

| Component | Version | Why pinned here |
| --- | --- | --- |
| Node | ≥ 22 | `@x402/stellar` and the x402 e2e suite both declare `engines.node >= 22` |
| pnpm | 10.32.1 | workspace resolution; `packageManager` field is authoritative |
| `@x402/core`, `@x402/stellar` | exactly `2.20.0` | moved 2.17.0 → 2.20.0 in two days (F-061) |
| `@stellar/stellar-sdk` | `^16.2.0` | `@x402/stellar` needs `^16.0.1`; a `^14` pin silently duplicated the SDK (F-059) |
| Fastify | `^5` | HTTP surface |
| Vitest | `^3` | tests |

`pnpm test` runs `scripts/check-single-stellar-sdk.mjs` before the suite, because two SDK
copies produce XDR objects that fail `instanceof` across the package boundary — a failure
that presents as nonsense type errors rather than as a version conflict (D-013).

## 3. `packages/facilitator`

### 3.1 What it does and does not do

The facilitator is a **wrapper**, and the wrapping line is drawn deliberately.

`ExactStellarScheme` from `@x402/stellar` already enforces every MUST in
`specs/schemes/exact/scheme_exact_stellar.md` and emits 37 machine-readable reason codes
doing it (FACTS F-045). walras adds **zero** payment validation. Its jobs are:

1. **HTTP surface** — the three endpoints the x402 v2 spec section 7 defines.
2. **Configuration** — turning operator environment into scheme constructor arguments.
3. **Error model** — guaranteeing a machine-readable code *and* a non-null human reason on
   every rejection, including the ones the package leaves unexplained.
4. **Kind routing** — refusing payment kinds this deployment does not serve, with a named
   reason instead of an opaque 500.

Anything beyond that would be a fork, and a stricter wrapper would reject payloads the
reference client legitimately produces (DECISIONS D-008).

### 3.2 Request path

```
POST /verify                              POST /settle
  |                                         |
  parseEnvelope        <-- walras           parseEnvelope
  assertSupportedKind  <-- walras           assertSupportedKind
  |                                         |
  x402Facilitator.verify                    x402Facilitator.settle
  |                                         |
  ExactStellarScheme.verify                 ExactStellarScheme.settle
    protocol -> structure -> args             -> full verify (again, by spec)
    -> simulate -> fee ceiling                -> rebuild with submitter as source
    -> events -> auth entries                 -> sign -> [fee bump] -> submit -> poll
  |                                         |
  withVerifyReason     <-- walras           withSettleReason  <-- walras
```

`/settle` deliberately does **not** call verify first. Spec Protocol Flow step 10 requires
settle to verify independently, and the package already does so as its first step
(FACTS F-036) — a wrapper-level pre-verify would double every simulation and add no safety.

### 3.3 HTTP status codes

| Situation | Status | Body |
| --- | --- | --- |
| Payment verified / settled | 200 | `VerifyResponse` / `SettleResponse` |
| Payment **rejected** by the scheme | 200 | same shape, `isValid: false` / `success: false` |
| Request not interpretable as an x402 exchange | 400 | same shape, `walras_*` code |
| Unknown route | 404 | `{ error: { code, reason } }` |
| Wrapper fault | 500 | same shape, `walras_internal_error` |

A protocol-level rejection is a successful exchange about an invalid payment, so it is a
200 — matching the reference facilitator and spec section 7.1's own "Error Response"
example. 4xx is reserved for requests the facilitator could not interpret at all.

Wrapper rejections are still rendered in the protocol shape rather than a bare
`{ error: ... }`, because the stock `HttpFacilitatorClient` parses a non-2xx body and, when
it finds `isValid`, raises a `VerifyError` carrying `invalidReason` to the caller. A
different shape would drop the machine-readable code at that boundary.

### 3.4 Error model

Two disjoint taxonomies, enumerated in `src/errors.ts` (DECISIONS D-007):

- **37 inherited codes** from `@x402/stellar`, passed through verbatim, never shadowed.
- **7 `walras_*` codes** covering only what the package is silent about: envelope
  validation, kind routing, unknown routes, wrapper faults.

Every code in both sets has human-readable text. The package populates `invalidMessage` on
exactly one of its paths, so walras backfills the rest — the code is never rewritten, only
the message is filled in. That is what makes RFP 3.6's "non-null reason on every rejection"
true by construction rather than by assertion.

A test greps the *installed* package bundle for reason-code literals and fails if the set
differs from the enumeration. Drift, not inability, is this project's failure mode (F-061).

### 3.5 Configuration

| Variable | Required | Default |
| --- | --- | --- |
| `NETWORK` | no | `stellar:testnet` |
| `RPC_URL` | on pubnet | `https://soroban-testnet.stellar.org` |
| `SUBMITTER_SECRET` | **yes** | — |
| `FEE_BUMP_SECRET` | no | unset |
| `PORT` | no | `4021` |
| `FEE_MODE` | no | `free` |
| `DB_PATH` | no | `./data/catalog.db` |
| `MAX_TRANSACTION_FEE_STROOPS` | no | `50000` |

Notes:

- `SUBMITTER_SECRET` takes one seed or a comma-separated list, enabling the package's
  round-robin signer selection. With `FEE_BUMP_SECRET` set, settlement is wrapped in a
  fee-bump transaction — which is how the reference operator runs in production
  (FACTS F-055, DECISIONS D-012). `FACILITATOR_STELLAR_PRIVATE_KEY` is accepted as an
  alias so an environment set up for the x402 e2e suite works unchanged (F-056).
- `FEE_MODE` governs whether walras charges a **service** fee. `free` is the only
  implemented value and anything else is a startup error rather than a silent fallback.
  It is distinct from `extra.areFeesSponsored`, which is about **network** fees and is
  always `true` because the package always sponsors them (F-006).
- `DB_PATH` is reserved for the discovery catalog. It is validated and reported by
  `/health`; nothing opens it yet.

Invalid configuration exits with `EX_CONFIG` (78) before a port is bound. A facilitator
that starts on half-valid configuration advertises capability it cannot honour.

### 3.6 `/supported`

Served straight from `x402Facilitator.getSupported()`: `kinds`, `extensions`, and
`signers`, all three required (FACTS F-040). The Stellar kind carries
`extra.areFeesSponsored: true`, byte-identical to what `x402.org/facilitator/supported`
advertises for `stellar:testnet` (F-041, EVIDENCE S0-2) — asserted against the captured
value in `test/supported.test.ts`.

`extensions` is `[]`. walras will list `bazaar` when the discovery endpoints exist and not
before; advertising an unreachable extension is the exact gap the RFP screens for
(DECISIONS D-010, D-016).

## 4. Testing strategy

Tests drive the Fastify app through `inject`, so no socket is bound, and configuration is
passed to `loadConfig` explicitly rather than through `process.env` — the suite needs no
`.env` and no secrets.

The one thing tests cannot redirect is the ledger-close-time estimate: the package reaches
a hard-coded Horizon URL with no configuration hook, falling back to 5 s on error
(FACTS F-034). Fixtures are built to hold for any estimate between 1 s and 10 s, so the
result never changes what a test asserts; `test/setup.ts` bounds the call so an offline run
cannot hang on it.

### 4.1 The Soroban RPC double

`test/helpers/soroban-rpc-double.ts` is an in-process JSON-RPC server.

It exists because of an ordering fact: `ExactStellarScheme` reaches the interesting half of
its verification — expiry bounds, signature status, sub-invocations, transfer events — only
*after* simulation succeeds. Simulation cannot succeed against live testnet until a buyer
holds testnet USDC, which is what FACTS Q-011 is blocked on. Without the double every
fixture collapses into the same `invalid_exact_stellar_payload_simulation_failed`, and the
suite would prove nothing past that point.

It models three things and is explicit about the rest:

- **Auth-entry signatures**, verified for real: Ed25519 over the CAP-46 authorization
  preimage, the same bytes `authorizeEntry` signs. A tampered signature fails here as it
  would in the Soroban host.
- **Transfer events**, synthesized from the invocation actually present in the
  transaction — change the amount and the event follows, so the package's event checks are
  exercised rather than fed a fixed answer.
- **Captured wire shapes**: `getLatestLedger` replays a response captured verbatim from
  live testnet.

It is not a Soroban VM: no balances, no footprints, no nonce consumption. Results obtained
through it are **modelled, not observed on-chain**, and are labelled that way in EVIDENCE.

## 5. Fixtures

`packages/facilitator/test/fixtures/exact-stellar.json`, regenerated by
`node scripts/build-fixtures.mjs`.

The transactions are **synthesized, not captured**. Session 0 could not capture a real
signed payload — a stock client cannot build one without a USDC-funded buyer (Q-011). What
Session 0 did establish is everything the fixtures are built from: the testnet accounts,
the USDC SAC verified four independent ways (F-052), the payload shape (F-033), and the
expiry rule (F-034). Keys are real, signatures verify against the real preimage, the XDR is
real; the assembly is local. None of these transactions has been submitted to a network.

The facilitator identity in the fixtures is a disposable account derived from a fixed
phrase, not the real Session 0 submitter — the facilitator-safety cases need the
facilitator's own address inside a transaction, and using the real one would make the suite
depend on a gitignored secret and refuse to run in CI.

## 6. Discovery layer (`packages/bazaar`, Sessions 3–4)

Three layers, deliberately transport-free so the facilitator owns all HTTP concerns:

- **store** — SQLite via Node's built-in `node:sqlite` (WAL, zero added dependencies;
  DECISIONS D-023). Listings are keyed on `(resource, type, toolName)` per the spec's MCP
  tuple MUST (FACTS F-029) and owned by the first settled `payTo` (D-024).
- **indexer** — the trust boundary. Everything echoed by the client is treated as hostile
  and admitted only through the SDK's low-level validators composed correctly
  (FACTS F-072); every rejection carries a machine code, and an indexer fault can degrade
  discovery but never a settlement (D-015).
- **wire** — mapping to the stock SDK's `DiscoveryResource` shape and the
  `EXTENSION-RESPONSES` header (F-024, F-050).

Cataloging is settle-gated: a listing exists because a payment settled on-chain through
walras, which is a deliberate anti-spam policy, not spec conformance (D-004).

## 7. Search (`GET /discovery/search`, Session 4)

The endpoint is spec-shaped end to end (FACTS F-026 … F-028): required `query` parameter
(never `q`, D-006), the same five filters as the list endpoint, a `resources` array
(never `items`, D-001), an explicit `partialResults`, and real keyset cursor pagination —
deliberate over-delivery against the spec's advisory MAY, per D-003 and RFP 3.2; no
reference operator implements it (F-013).

The pipeline: a **`Retriever`** ranks catalog rows for the query; the shared filter
semantics intersect that ranking; the cursor slices it. `Retriever` is a one-method seam
(`query → ranked ids + scores`), so ranking improvements never touch the wire contract,
the filters, or pagination.

### 7.1 BASELINE retriever

The pre-build ships exactly one retriever, labeled BASELINE (D-026): SQLite **FTS5 with
BM25** over four weighted fields — service name, description, parameter text (names and
JSON-Schema `description` annotations extracted from the bazaar extension; example values
are deliberately not indexed), and tags. Untrusted queries are compiled to
quoted-token-OR MATCH expressions, since raw FTS5 syntax throws (F-076). There is no
stemming, no stopword handling, no synonym expansion, no semantic matching — and the eval
set contains queries chosen to fail on exactly those gaps ("convert US dollars to euros"
against a corpus that says USD/EUR).

### 7.2 Evaluation harness — how result quality is measured over time

`pnpm eval:search` builds a fixture catalog from `eval/search/corpus.json` **through the
production indexing path**, runs the ~28 labeled queries in `eval/search/queries.json`,
and reports recall@1/3/5, MRR@10, and nDCG@5/10, writing
`eval/search/results/<date>.json`. Baseline numbers are recorded in EVIDENCE S4-3. This
harness is the answer to the RFP's "how will you evaluate result quality over time": a
ranking change is graded by re-running one command and diffing numbers, never by
eyeballing results.

### 7.3 Ranking upgrade path — GRANT scope

Not in the pre-build (its DO-NOT list forbids embedding/vector dependencies). For the
funded build, in measurement order:

1. **Lexical hygiene** — stopword handling and light stemming inside the BASELINE
   retriever (the eval set's "did it snow…" query documents the cost of their absence).
2. **Hybrid retrieval** — BM25 candidates fused with embedding-based dense retrieval
   (reciprocal-rank fusion first, learned weights only if the harness justifies them);
   embeddings computed at index time in the settle hook's existing budget discipline.
3. **Re-ranking** — a cross-encoder pass over the fused top-k, feasible because the
   catalog page size is bounded.

Each step lands only if it moves the harness's numbers on a labeled set that grows with
the catalog; the vocabulary-gap queries that score zero today are the acceptance tests
for step 2.
