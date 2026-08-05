# ARCHITECTURE — walras

How the system is built, as built. Every design claim cites a row in
[`FACTS.md`](./FACTS.md) or an entry in [`DECISIONS.md`](./DECISIONS.md); capability
claims link the transcript in [`EVIDENCE.md`](./EVIDENCE.md). Pinned spec commit:
`x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`.

Anything not yet built is marked **PLANNED** and stated as intent, not capability.

![System components](./diagrams/system-components.svg)

*Source: [`diagrams/system-components.mmd`](./diagrams/system-components.mmd)*

---

## 1. Components and responsibilities

Three packages, split along the seam the spec itself draws: `bazaar.md` says storing,
indexing, and exposing discovered resources is "an implementation detail" of the
facilitator (FACTS F-023), so discovery lives in its own transport-free library and the
facilitator remains a payment component whose only catalog knowledge is a settle-success
hook and two GET routes.

| Package | Owns | Does NOT own |
| --- | --- | --- |
| `packages/facilitator` | HTTP surface, configuration, error model, kind routing, the settle-time indexing hook | Payment validation — every payment MUST is enforced by `@x402/stellar`'s `ExactStellarScheme` (F-045) |
| `packages/bazaar` | Catalog persistence, the indexing trust boundary, search, wire mapping | HTTP — the facilitator mounts it |
| `packages/mcp-server` | The two agent tools `search_resources` and `paid_call`, spend policy, resource ids | Payment protocol and discovery semantics — it composes stock clients and the facilitator's endpoints (F-080) |

```
walras/
├── docs/                        # FACTS, DECISIONS, EVIDENCE, this suite; api/, reference/, diagrams/ are generated
├── packages/
│   ├── facilitator/             # x402 facilitator                        ← built (S1–S3)
│   │   └── src/
│   │       ├── config.ts        # env surface + CONFIG_REFERENCE (the generated-docs source)
│   │       ├── errors.ts        # the two reason-code taxonomies (D-007)
│   │       ├── routeSchemas.ts  # route JSON Schemas — the OpenAPI source (R3)
│   │       ├── facilitator.ts   # config -> ExactStellarScheme -> x402Facilitator
│   │       ├── server.ts        # Fastify app; routes carry the schemas
│   │       └── index.ts         # boot: load env, build, listen
│   ├── bazaar/                  # settle-gated discovery catalog          ← built (S3–S4)
│   │   └── src/                 # store, indexer, retriever, searchtext, cursor, reasons, wire
│   └── mcp-server/              # search_resources + paid_call over stdio ← built (S6)
│       └── src/                 # server, catalog, paidCall, id, config, errors
├── demo/                        # stock seller/buyer, hostile clients, MCP seller + session
├── eval/search/                 # labeled queries + metrics harness (§8.2)
├── scripts/
│   ├── docs/                    # generators for openapi/config/errors/ERD + diagram rendering
│   └── …                        # setup-accounts, preflight, fixtures, license-scan, demo
└── .github/workflows/ci.yml     # tests, license gate, docs:gen + docs:check
```

## 2. Toolchain

Pinned per FACTS F-058 / F-059 and DECISIONS D-013; docs tooling per F-084 / D-031.

| Component | Version | Why pinned here |
| --- | --- | --- |
| Node | ≥ 22 | `@x402/stellar` and the x402 e2e suite both declare `engines.node >= 22` (F-058) |
| pnpm | 10.32.1 | workspace resolution; `packageManager` field is authoritative |
| `@x402/core`, `@x402/stellar`, `@x402/extensions`, `@x402/mcp`, `@x402/fetch` | exactly `2.20.0` | upstream moved 2.17.0 → 2.20.0 in two days (F-061) |
| `@stellar/stellar-sdk` | `^16.2.0` | a `^14` pin silently duplicated the SDK in the tree (F-059) |
| Fastify | `^5` | HTTP surface |
| `@modelcontextprotocol/sdk` | `^1.12.1` | MCP transport (F-078) |

`pnpm test` runs `scripts/check-single-stellar-sdk.mjs` first, because two SDK copies
produce XDR objects that fail `instanceof` across the package boundary — a failure that
presents as nonsense type errors rather than a version conflict (D-013).

## 3. The facilitator

### 3.1 What it does and does not do

The facilitator is a **wrapper**, and the wrapping line is drawn deliberately.
`ExactStellarScheme` already enforces every MUST in
`specs/schemes/exact/scheme_exact_stellar.md` and emits 37 machine-readable reason codes
doing it (FACTS F-045). walras adds **zero** payment validation. Its jobs:

1. **HTTP surface** — the endpoints in [`api/openapi.yaml`](./api/openapi.yaml),
   generated from the route schemas (§9).
2. **Configuration** — operator environment → scheme constructor arguments; the full
   table is generated in [`reference/config.md`](./reference/config.md).
3. **Error model** — a machine-readable code *and* a non-null human reason on every
   rejection (§3.4); the full registry is generated in
   [`reference/errors.md`](./reference/errors.md).
4. **Kind routing** — refusing payment kinds this deployment does not serve with a named
   reason instead of an opaque 500.

Anything beyond that would be a fork, and a stricter wrapper would reject payloads the
reference client legitimately produces (DECISIONS D-008).

### 3.2 Settlement path walkthrough

![Payment and settlement sequence](./diagrams/payment-settlement-sequence.svg)

*Source: [`diagrams/payment-settlement-sequence.mmd`](./diagrams/payment-settlement-sequence.mmd).
The full wire transcript of exactly this flow, stock client on both sides, is
EVIDENCE S2-2.*

Step by step, with the load-bearing facts:

1. The buyer's first request carries no payment; the seller answers **402** with terms
   in the `PAYMENT-REQUIRED` header — the v2 canonical name, not `X-PAYMENT` (F-065).
2. The buyer's wallet signs a **Soroban auth entry** authorizing exactly
   `transfer(from, to, amount)` on the asset contract — not a pre-signed transaction
   (F-033). Validity is ledger-bounded, derived from `maxTimeoutSeconds` (F-034).
3. The seller's middleware POSTs `{paymentPayload, paymentRequirements}` to `/verify`.
   The scheme checks protocol, transaction structure, arguments, simulation, transfer
   events, auth entries, and facilitator safety — in that order, with simulation as the
   gate for the auth-entry and event checks (F-035, F-064).
4. On `isValid: true` the seller executes the resource, then POSTs the same envelope to
   `/settle`. walras runs **no wrapper-level pre-verify**: the spec requires settle to
   verify independently and the scheme's `settle()` already does so as its first step
   (F-036) — a wrapper pre-verify would double every simulation and add no safety.
5. The scheme rebuilds the transaction with a walras submitter as source (the buyer's
   signed auth entry rides along), signs, submits, and polls. The receipt is
   `{success, transaction, network, payer}` with the 64-hex on-chain hash (F-038).
6. Fees: the submitter sponsors the network fee — the buyer needs only the payment asset
   (F-006). Measured on `stellar:testnet`: 22 973 stroops per settlement, uniform across
   every observed walras settlement (F-069, EVIDENCE S2-3).

HTTP status convention: a payment the scheme rejects is a **200** carrying
`isValid: false` / `success: false` — a successful exchange about an invalid payment,
matching the reference facilitator. **4xx** is reserved for requests that could not be
interpreted as an x402 exchange at all, and even those are rendered in the protocol
shape so the stock client's error path keeps the machine-readable code (§3.4).

### 3.3 Error model

Two disjoint taxonomies, enumerated in `src/errors.ts` (DECISIONS D-007) and rendered
into [`reference/errors.md`](./reference/errors.md) by the generator:

- **37 inherited codes** from `@x402/stellar`, passed through verbatim, never shadowed.
- **10 `walras_*` codes** covering only what the package is silent about: envelope
  validation, kind routing, discovery query interpretation, unknown routes, wrapper
  faults.

The package populates a human-readable message on exactly one of its paths, so walras
backfills the rest — the code is never rewritten, only the message is filled in. That is
what makes RFP 3.6's "non-null reason on every rejection" true by construction rather
than by assertion. A test greps the *installed* package bundle for reason-code literals
and fails if the set differs from the enumeration (F-063) — drift, not inability, is
this project's failure mode (F-061).

### 3.4 Configuration

Generated from the in-code `CONFIG_REFERENCE` tables:
[`reference/config.md`](./reference/config.md). Two properties worth naming here:

- Invalid configuration exits with `EX_CONFIG` (78) **before a port is bound**. A
  facilitator that starts on half-valid configuration advertises capability it cannot
  honour.
- `FEE_MODE` governs the **service** fee (only `free` is implemented; anything else is a
  startup error). It is distinct from `extra.areFeesSponsored`, which is about
  **network** fees and is always `true` because the scheme always sponsors them (F-006).

### 3.5 `/supported`

Served straight from `x402Facilitator.getSupported()`: `kinds`, `extensions`, and
`signers`, all three required (F-040). The Stellar kind carries
`extra.areFeesSponsored: true`, byte-identical to the x402.org baseline capture for
`stellar:testnet` (F-041, EVIDENCE S0-2) — asserted against the captured value in
`test/supported.test.ts`. `extensions` lists `bazaar` because the discovery endpoints
are mounted and reachable; it was an empty array until they were (D-016 — advertised
support and reachable support must never diverge, in either direction).

## 4. The indexing invariant: cataloging never blocks settlement

The settle response is produced from the chain result alone. The indexing hook runs
*after* the settlement outcome is decided, and nothing it does can change that outcome
(DECISIONS D-015):

- The indexer **never throws** by contract; a belt-and-braces catch in the route holds
  the invariant even against a bug in the hook glue itself.
- Its work is structurally bounded: a 64 KiB cap on the extensions block before any
  validation touches it, and a 100 ms database busy timeout — that is how the "small
  budget" is enforced rather than promised (D-025). A soft 250 ms budget makes
  violations visible in logs without preempting anything.
- Its outcome only ever *decorates* the response with the `EXTENSION-RESPONSES` header
  (F-024): `success`, or `rejected` with a human `rejectedReason` plus an additive
  machine `code` (D-014). An internal indexer fault omits the header entirely — a
  walras bug is never reported as a client defect (D-025).
- A forced-failure test pins it: settlement succeeds while the catalog store is broken
  (the D-015 test in the facilitator suite).

The lifecycle, end to end:

![Payment lifecycle](./diagrams/payment-lifecycle-state.svg)

*Source: [`diagrams/payment-lifecycle-state.mmd`](./diagrams/payment-lifecycle-state.mmd)*

## 5. Throughput design

As built (EVIDENCE S2-3, S5-2): a single submitter account sources every settlement,
`source_account == fee_account`, and every observed settlement charged 22 973 stroops
(F-069).

The scale-out path is **configuration, not engineering**, because the package already
ships it (D-012):

- `SUBMITTER_SECRET` accepts a comma-separated list; multiple submitters run under the
  package's round-robin signer selection (F-044).
- `FEE_BUMP_SECRET` wraps each settlement in a fee-bump transaction, decoupling fee
  payment from sequence-number management (F-047). The reference operator runs exactly
  this posture in production — its settlements show `source_account ≠ fee_account`
  (F-055). Captured live for walras itself (EVIDENCE S7-1): five settlements through
  the fee-bump path, `fee_account ≠ source_account` verified on Horizon, fee 23 073
  stroops — exactly the D-021 delta of 100 stroops over the single-submitter posture,
  and byte-matching the baseline's fee anatomy (F-054).

**PLANNED (RFP 3.5, grant scope):** a managed channel-account pool — pre-created
submitter accounts sized to observed load, health-checked, rotated on sequence
contention — plus load-shedding rules. The design intent is that bursty agent traffic
never queues on one sequence number; the pre-build demonstrates the mechanism
(multi-signer round-robin + fee-bump) without the pool manager.

## 6. Deployment topologies

![Deployment topologies](./diagrams/deployment-topologies.svg)

*Source: [`diagrams/deployment-topologies.mmd`](./diagrams/deployment-topologies.mmd)*

### 6.1 Hosted

One operator runs walras for many sellers; the shared catalog is the point — every
seller that settles through the instance becomes discoverable to every buyer that
queries it (D-004). This is the topology every EVIDENCE transcript runs. The hosted
instance is operated by us; nothing about the protocol privileges it (§6.2).

### 6.2 Self-hosted

The same code, run by anyone: `git clone`, set `SUBMITTER_SECRET`, start
([`runbook.md`](./runbook.md)). Apache-2.0 with a copyleft-free dependency path
(F-060, D-031) is what makes this real rather than nominal — the RFP's "the ecosystem
must not depend on a single hosted operator" is satisfied by the license and the
runbook, not by a promise. A self-hosted instance catalogs what settles through *it*;
federation across catalogs is **PLANNED** (interop direction, not yet designed in
detail).

### 6.3 Self-facilitation inside a resource server — PLANNED

RFP 3.1 asks for the facilitator to be embeddable next to the routes it serves, no
separate process. The seam exists as built — `buildServer` takes injected config and
store, and the tests drive the whole app in-process through `inject` with no socket —
but no packaged embedding mode ships in the pre-build. **PLANNED:** an exported
`createSelfFacilitatingMiddleware` (working name) that mounts verify/settle/discovery
inside an Express/Fastify resource server, sharing the catalog store.

## 7. Discovery layer (`packages/bazaar`)

![Automatic cataloging](./diagrams/auto-catalog-sequence.svg)

*Source: [`diagrams/auto-catalog-sequence.mmd`](./diagrams/auto-catalog-sequence.mmd).
Proven live: EVIDENCE S3-3 (pay → listed, zero registration), S3-4 (hostile writes
soft-dropped while their settlements succeeded).*

Three layers, deliberately transport-free:

- **store** — SQLite via Node's built-in `node:sqlite` (WAL, zero added dependencies;
  D-023). Listings are keyed on `(resource, type, toolName)` per the spec's MCP tuple
  MUST (F-029) and owned by the first settled `payTo` (D-024). Schema ERD:
  [`diagrams/catalog-erd.svg`](./diagrams/catalog-erd.svg) — generated from the DDL.
- **indexer** — the trust boundary. Everything echoed by the client is hostile until
  validated (F-072); every rejection carries a machine code; an indexer fault can
  degrade discovery but never a settlement (§4).
- **wire** — mapping to the stock SDK's `DiscoveryResource` shape and the
  `EXTENSION-RESPONSES` header (F-024, F-050). `lastUpdated` is the ISO 8601 string the
  SDK type declares, not the v2 spec's conflicting Unix-number example (D-002).

Cataloging is settle-gated: a listing exists because a payment settled on-chain through
walras. That is a deliberate anti-spam policy, not spec conformance (F-023, D-004), and
it is why there is no registration endpoint at all (D-022).

## 8. Search (`GET /discovery/search`)

Spec-shaped end to end (F-026 … F-028): required `query` parameter (never `q`, D-006),
the same five filters as the list endpoint, a `resources` array (never `items`, D-001),
an explicit `partialResults`, and real keyset cursor pagination — deliberate
over-delivery against the spec's advisory MAY, per D-003; no reference operator
implements it (F-013).

The pipeline: a **`Retriever`** ranks catalog rows for the query; the shared filter
semantics intersect that ranking; the cursor slices it. `Retriever` is a one-method seam
(`query → ranked ids + scores`), so ranking improvements never touch the wire contract,
the filters, or pagination.

### 8.1 BASELINE retriever

The pre-build ships exactly one retriever, labeled BASELINE (D-026): SQLite **FTS5 with
BM25** over four weighted fields — service name (4.0), description (2.0), parameter
text (1.0), tags (3.0); weights are rule-of-thumb, explicitly untuned. Parameter text is
parameter *names* plus JSON-Schema `description` annotations; example values are
deliberately not indexed (an example city of "Zurich" says nothing about what a resource
does). Untrusted queries are compiled to quoted-token OR expressions, since raw FTS5
syntax throws (F-076). There is no stemming, no stopword handling, no synonym
expansion — and the eval set contains queries chosen to fail on exactly those gaps.

### 8.2 Evaluation harness

`pnpm eval:search` builds a fixture catalog from `eval/search/corpus.json` **through the
production indexing path**, runs the 28 labeled queries in `eval/search/queries.json`,
and reports recall@1/3/5, MRR@10, and nDCG@5/10. Baseline numbers are recorded in
EVIDENCE S4-3 (recall@5 0.93, MRR@10 0.91). This harness is the answer to "how will you
evaluate result quality over time": a ranking change is graded by re-running one command
and diffing numbers, never by eyeballing results.

### 8.3 Ranking upgrade path — PLANNED (grant scope)

In measurement order, each step landing only if it moves the harness's numbers:
lexical hygiene (stopwords, light stemming) → hybrid retrieval (BM25 fused with dense
embeddings computed at index time, reciprocal-rank fusion first) → cross-encoder
re-ranking over the fused top-k. The vocabulary-gap queries that score zero today are
the acceptance tests for the second step.

## 9. MCP server (`packages/mcp-server`)

![Agent discovery flow](./diagrams/discovery-agent-flow.svg)

*Source: [`diagrams/discovery-agent-flow.mmd`](./diagrams/discovery-agent-flow.mmd).
Proven live with a generic MCP client carrying zero walras imports: EVIDENCE S6-3 —
including paying a live MCP tool whose own settlement auto-cataloged it.*

Two tools over stdio, and the whole discover→pay loop behind them (F-080 — the tools,
the bridge, and catalog resolution are entirely this repository's build; `@x402/mcp`
supplies only the payment-aware client and the server-side wrapper):

- **`search_resources`** — ranked catalog search via the facilitator's
  `/discovery/search`. Each hit carries a deterministic, self-describing id
  (`wr1:` + base64url of the listing tuple, D-029), price in base units, network, and
  the machine-readable calling convention (F-082).
- **`paid_call`** — resolves the target (by id against the live catalog, or by
  url + toolName), probes its live 402, applies the spend policy, and pays through the
  stock client path. The cap binds twice: a pre-payment check *and* a
  `registerPolicy` filter on the one shared `x402Client`, so no transport can bypass it
  (F-081, D-030).

Every failure on every path is a structured `{errorCode, reason}` tool result —
facilitator codes pass through verbatim, `walras_mcp_*` codes cover only this server's
own surface, and results are dual-format (structured content + identical JSON text) per
the MCP transport spec's rule (F-079, D-028).

## 10. Testing strategy

Tests drive the Fastify app through `inject` (no socket) and the MCP server through
real in-memory MCP transports (S6-2); configuration is passed explicitly, so the suite
needs no `.env` and no secrets. Workspace total after the docs session: 213 tests
(bazaar 64, facilitator 99, mcp-server 50).

The route schemas attached in `server.ts` are documentation-grade: no-op validator and
serializer compilers keep runtime behavior identical to a schema-less app (no Ajv
coercion, no fast-json-stringify field dropping), which the behavioral suite pins.

### 10.1 The Soroban RPC double

`test/helpers/soroban-rpc-double.ts` is an in-process JSON-RPC server. It exists
because of an ordering fact: the scheme reaches its auth-entry and transfer-event
checks only *after* simulation succeeds (F-064), so those codes are unreachable
against a live network in a hermetic suite. The double verifies auth-entry signatures
for real (Ed25519 over the CAP-46 preimage) and synthesizes transfer events from the
transaction actually submitted; it is not a Soroban VM — no balances, no footprints,
no nonce consumption. Results obtained through it are **modelled, not observed
on-chain**, and are labelled that way in EVIDENCE (D-017). Live S2 replays confirmed
its predictions exactly where the two overlap (D-017 follow-up).

### 10.2 Fixtures

`packages/facilitator/test/fixtures/exact-stellar.json`, regenerated by
`node scripts/build-fixtures.mjs`. The transactions are synthesized, not captured —
keys are real, signatures verify against the real preimage, the XDR is real; the
assembly is local, and none has been submitted to a network. The facilitator identity
in fixtures is a disposable account so the suite runs in CI without secrets.

## 11. Documentation pipeline

Generated-over-transcribed (writing rule R3): `pnpm docs:gen` regenerates
[`api/openapi.yaml`](./api/openapi.yaml) from the Fastify route schemas,
[`reference/config.md`](./reference/config.md) from the `CONFIG_REFERENCE` tables,
[`reference/errors.md`](./reference/errors.md) from the error enumerations, the catalog
ERD from the store's DDL, and re-renders any diagram whose SVG is stale (source-hash
markers, rule R6). `pnpm docs:check` fails CI on generator drift, invalid OpenAPI,
stale SVGs, dead links, banned words, uncited capability claims, and dated roadmap
items. Docs tooling licenses were pre-checked before install (F-084); the license gate
is two-tier per D-031.
