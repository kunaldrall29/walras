# walras: an x402 facilitator and discovery bazaar for Stellar

*A systems design paper. Version 0.1 — testnet pre-build.*

Every normative claim in this paper cites a row in [`FACTS.md`](../FACTS.md) (F-nnn),
an entry in [`DECISIONS.md`](../DECISIONS.md) (D-nnn), or a transcript in
[`EVIDENCE.md`](../EVIDENCE.md) (S*n*-*n*). The x402 protocol is quoted at the pinned
commit `x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`; section 13
indexes the sources.

---

## 1. Abstract

walras is a payment facilitator for the x402 protocol on Stellar, paired with the thing
the Stellar ecosystem lacks: a native **Bazaar** — a discovery layer in which any paid
HTTP endpoint or MCP tool that settles a payment becomes automatically searchable by
agents, with no registration step anywhere.

Three properties define the system. **Conformance at the wire**: an unmodified stock
x402 client completed the full 402 → sign → verify → settle round-trip through walras
on `stellar:testnet`, with the settlement on-chain (F-066, EVIDENCE S2-2), and the
protocol repository's own end-to-end suite passes against walras 4/4 (F-067, EVIDENCE
S2-4). **Settlement as registration**: the catalog is settle-gated — a listing exists
because a real payment settled through the facilitator, which is an anti-spam design
choice, not a spec mandate, and is documented as such (F-023, D-004). **Machine-legible
failure**: every rejection on every path — payment, catalog, search, MCP tool — carries
a stable machine-readable code plus a non-null human-readable reason (D-007, D-028).

Everything demonstrated in this paper ran on `stellar:testnet`; the system is
unaudited, and section 12 states the limitations without decoration.

## 2. Background: HTTP 402 and machine-native payments

HTTP reserved status code 402 ("Payment Required") three decades ago and never
standardized what to do with it. x402 fills that hole with a machine-native flow: a
client requests a resource; the server replies 402 with concrete payment terms; the
client signs a payment authorization and retries; a **facilitator** verifies the
authorization and settles it on-chain before the resource is returned. The buyer is
software — typically an agent paying per request, holding no account and no API key
(the RFP's own framing, [`rfp.md`](../rfp.md) §2).

Two structural facts about the protocol matter for everything that follows. First, the
facilitator is a *coordination* role, not a custody role: it validates and submits, but
the value moves directly from buyer to seller (F-035, F-038). Second, the protocol is
young and moving — x402 v2 formalized discovery as the Bazaar extension, the x402
Foundation now stewards the spec with the Stellar Development Foundation holding a
Governing Board seat (F-016), and the SDK surface shifted three minor versions in the
two days between two of our own fact-checks (F-061). A facilitator that freezes on its
award date is a facilitator that stops interoperating; section 11 describes the
discipline walras adopts against exactly that.

## 3. Why Stellar

**Fees make micropayments arithmetic, not aspiration.** A settlement on
`stellar:testnet` costs the submitter 22 973 stroops = 0.0022973 XLM, measured
uniformly across every walras settlement observed (F-069), consistent with the
0.0023073 XLM measured at the public x402.org facilitator (F-054). A fee that is a
fraction of a cent is what keeps per-request pricing viable when the payment itself
may be one cent.

**Finality is fast and expiry is ledger-native.** Payment validity is bounded by a
signature expiration *ledger*, derived as
`ceil(maxTimeoutSeconds / estimatedLedgerSeconds)` — about 12 ledgers ≈ 60 seconds at
the default (F-034, F-007). The expiry window an agent reasons about is a protocol
property, not an operator promise.

**Stablecoins are first-class.** Any SEP-41 token works; USDC is the default with
7-decimal base units (F-008). Classic assets reach Soroban through the Stellar Asset
Contract; the testnet USDC SAC was verified four independent ways, including
re-deriving the contract ID cryptographically from the issuer (F-052).

**The authorization model fits the flow.** A Stellar buyer signs a **Soroban auth
entry** authorizing exactly one contract call — `transfer(from, to, amount)` on one
asset — rather than a whole pre-signed transaction (F-033). The facilitator builds and
submits the enclosing transaction and sponsors its fee, so the buyer needs only the
payment asset and no XLM (F-006), advertised on the wire as
`extra.areFeesSponsored: true` (F-041). Recipient, amount, and asset live *inside* the
signed authorization — the property section 4 leans on.

## 4. System design

### 4.1 Non-custodial facilitation

walras wraps `@x402/stellar`'s `ExactStellarScheme`, which enforces every MUST in the
exact-Stellar scheme spec and emits 37 machine-readable reason codes doing it (F-044,
F-045). The wrapper adds zero payment validation of its own — a deliberate line,
because a stricter wrapper would reject payloads the reference client legitimately
produces (D-008). The scheme's verification list is the facilitator's constitution
(F-035): protocol fields; transaction structure (exactly one `invokeHostFunction`,
contract equals the required asset, function is `transfer` with the required recipient
and amount); mandatory re-simulation against current ledger state; transfer-event
checks confirming the exact balance change; auth-entry checks (expiry bound, credential
type, no sub-invocations, all signers signed); and **facilitator safety** — the
facilitator must not be the transaction source, the operation source, the payer, or a
participant in any auth entry. The receipt names the buyer as `payer`, never the
facilitator (F-038).

One inherited subtlety is worth stating as plainly as we recorded it: the scheme's own
signature check only tests that a signature is *present*; a forged signature is caught
by the Soroban host during mandatory simulation, which makes "simulation MUST succeed"
the cryptographic control rather than defense-in-depth (F-062). Replay resistance is
likewise structural — a consumed auth-entry nonce makes re-simulation fail — and walras
documents it that way instead of claiming a coded replay check that does not exist
(F-039, D-011).

### 4.2 Sponsorship and settlement lifecycle

At settle time the spec requires full independent re-verification, and the scheme
performs it as its first step, so walras adds no wrapper-level pre-verify that would
double every simulation (F-036). The scheme rebuilds the transaction with a walras
submitter as source, derives the fee from a fresh simulation and fully overrides the
client's fee bid under a hard ceiling (F-037), signs, submits, and polls. Multiple
submitter seeds run under round-robin selection, and an optional fee-bump signer
decouples fee payment from sequence management — the posture the reference operator
runs in production (F-047, F-055, D-012). The full lifecycle, including the discovery
hook that runs strictly after the settlement outcome is decided, is drawn in
[`payment-lifecycle-state.svg`](../diagrams/payment-lifecycle-state.svg).

### 4.3 The error model

Two disjoint taxonomies (D-007): the 37 scheme codes pass through verbatim, and ten
`walras_*` codes cover only what the scheme is silent about — envelope validation, kind
routing, discovery queries, wrapper faults. The scheme populates a human-readable
message on exactly one path; walras backfills the rest without ever rewriting the code,
which is what makes "a non-null reason on every rejection" true by construction. The
full registry is generated from the enumerations in code
([`reference/errors.md`](../reference/errors.md)), and a test greps the *installed*
upstream bundle so an upstream rename breaks the build instead of silently degrading a
rejection reason (F-063).

## 5. The Bazaar

### 5.1 Pay-to-list

A seller declares discovery metadata in route configuration; the stock client echoes it
into the payment payload (F-032); when the payment settles, walras validates the echoed
extension and writes the listing — the whole integration is one declaration, and no
registration endpoint exists at all (D-022). The spec deliberately does not mandate
settle-gating — it calls storage and indexing "an implementation detail" (F-023) — so
walras states it as policy: a listing should cost a real payment. The loop was
exercised live: stock buyer pays stock seller through walras, the listing appears with
zero registration steps, and the seller's own middleware logs the success header
(F-075, EVIDENCE S3-3).

### 5.2 The trust boundary

Everything a client echoes is attacker-controlled, and the SDK's convenience extractor
is explicitly *not* a sufficient boundary — it validates only against the
client-supplied schema, so a trivial schema validates anything (F-072). walras composes
the low-level validators itself: protocol invariants *and* client schema, the
soft-drop metadata rules for `serviceName`/`tags`/`iconUrl` (F-031), and
`routeTemplate` validation with percent-decoding applied *before* the traversal and
scheme-smuggling checks (F-030). Listing identity is the tuple
`(resource, type, toolName)` — MCP tools are keyed on URL *and* tool name because MCP
multiplexes tools over one endpoint (F-029) — and each listing is owned by the first
settled `payTo`, the only identity signal a hostile client cannot fabricate, because
the scheme verified the on-chain transfer credits it (D-024).

The strongest evidence is the negative live test: a structurally valid, actually
settled on-chain payment directed at another seller's URL could not touch that seller's
listing — the settlement succeeded, the catalog write was refused with
`bazaar_listing_owned_by_other_payee`, and the listing was byte-identical afterward
(EVIDENCE S3-4). Cataloging outcomes ride the `EXTENSION-RESPONSES` header (F-024) with
a machine code alongside the spec's human-readable reason (D-014); an internal walras
fault omits the header rather than blaming the client (D-025). The full threat
inventory, including the residuals we chose to disclose rather than hand-wave —
micro-settlement spam economics and URL squatting — is
[`THREAT-MODEL.md`](../THREAT-MODEL.md).

### 5.3 Ecosystem interop

Interoperability here means: a stock `withBazaar` client pointed at walras compiles
against the same types and reads the same shapes it reads anywhere else. That required
following the SDK's wire types even where the prose is loose or contradictory: list
responses use `items` while search uses `resources` (F-027, D-001), and `lastUpdated`
is the ISO 8601 string the SDK type declares rather than the v2 spec example's Unix
number — a genuine spec/SDK conflict at the same commit, resolved in favor of what
stock clients compile against and flagged for upstream (D-002).

Two observed deviations between spec and operators are recorded neutrally. The
reference operator's search endpoint implements no pagination, and the reference SDK
catalog returns `pagination: null` unconditionally (F-013); walras implements real
keyset-cursor pagination with a truthful `partialResults` — over-delivery against an
advisory MAY, driven by the RFP's requirement (D-003, D-027). And the public
conformance baseline, x402.org, does not advertise the `bazaar` extension at all
(F-042), so for the discovery path there is no operator to diff against — conformance
is to the spec text and SDK types directly, which is exactly how walras approached it
(D-010). The reference e2e catalog also violates the spec's MCP tuple-keying MUST;
walras keys correctly and the defect is queued for an upstream report (D-009).

## 6. Search

The search deliverable is a ranking baseline *plus the instrument that measures it* —
in that order of importance, because an unmeasured ranker cannot honestly improve.

The BASELINE retriever (labeled as such in code and docs, D-026) is SQLite FTS5 with
BM25 over four weighted fields: service name, description, parameter text, and tags.
Parameter text is parameter *names* plus JSON-Schema `description` annotations from
the seller's declared metadata — example values are deliberately not indexed, because
an example city says nothing about what a resource does (D-026). Untrusted queries are
compiled to quoted-token expressions before reaching the engine, since raw FTS5 syntax
throws on operator characters (F-076). There is no stemming, no stopword handling, no
synonym expansion.

The evaluation harness (`pnpm eval:search`) builds a fixture catalog through the
production indexing path and scores 28 labeled queries. The baseline measured:
recall@1 0.84, recall@5 0.93, MRR@10 0.91, nDCG@10 0.91 (EVIDENCE S4-3). The labeled
set intentionally contains queries the baseline fails — vocabulary-gap phrasings like
"convert US dollars to euros" against a corpus that says USD/EUR — and those recorded
failures are the acceptance tests for the upgrade path: lexical hygiene, then hybrid
BM25-plus-embedding retrieval, then cross-encoder re-ranking, each step landing only if
it moves the harness's numbers (ARCHITECTURE §8.3; grant scope).

The endpoint is spec-shaped throughout: the required parameter is `query` — not `q`
(F-026, D-006) — the response array is `resources` (F-027), `partialResults` means
exactly "matches were truncated" (F-028, D-027), and a cursor replayed against a
different query is a named 400 rather than a silently wrong page (D-027).

## 7. Agent interface

`packages/mcp-server` exposes the entire discover→pay loop as two MCP tools —
`search_resources` and `paid_call` — over stdio. The division of labor is precise: the
upstream `@x402/mcp` package supplies a payment-aware MCP client and a server-side
payment wrapper, and nothing else; the tools, the catalog resolution, and the
MCP-to-HTTP bridge are walras's build (F-078, F-080).

The contract an agent gets (D-028): a tool never throws for a domain failure and never
returns prose-only errors — every result, success or failure, is structured content
plus the identical JSON as text, and every failure is `{errorCode, reason}` with
facilitator codes passed through verbatim. Results carry a deterministic,
self-describing resource id (`wr1:` + the listing tuple, D-029) that is re-resolved
against the live catalog before any payment, so a stale id yields a named error rather
than a payment to a delisted resource. Spending is capped per call, and the cap binds
twice — a pre-payment check against the probed 402 and a payment-requirements policy on
the one shared client, so a re-priced retry cannot bypass it (F-081, D-030).

The live proof is a generic MCP client with zero walras imports driving one session
(EVIDENCE S6-3): it searched, paid an HTTP listing by id, was correctly refused on a
forged id, paid a **live MCP tool** by (url, toolName) — whose own settlement
auto-cataloged it under the spec's tuple key (F-029) — then re-discovered and re-paid
that tool by its minted id. Three on-chain settlements, each at the measured
22 973-stroop fee (F-069).

## 8. The `upto` scheme on Stellar — design space

Status: **DESIGN, not implementation.** Nothing in this section ships in the pre-build.

`exact` settles a fixed amount per request. `upto` — authorize up to a cap, settle
actual usage — is the fit for metered services such as token-priced inference. The
scheme has EVM and SVM specifications but no Stellar one at the pinned commit (F-005),
so the Stellar work is authoring `scheme_upto_stellar.md` *and* an implementation,
upstreamed through the x402 Technical Steering Committee ([`rfp.md`](../rfp.md) §3.4).

**Why SEP-41 allowances alone are not enough.** The obvious contract-free primitive is
`approve(from, spender, amount, expiration_ledger)` +
`transfer_from`. It genuinely provides a cap and a ledger-bounded window. But an
allowance binds `(from, spender)` and an amount — it does not bind a **recipient**, and
it does not enforce **single settlement**. A facilitator holding an allowance could
split it across multiple settlements or direct value to a recipient the buyer never
named, and nothing on-chain would distinguish that from honest metering. This is the
trust gap the RFP itself names ([`rfp.md`](../rfp.md) §3.4), and any contract-free
design must state it as a weaker trust model rather than engineer around it with
assertions.

**Design A — contract-backed.** A small Soroban session contract holds the
authorization: buyer authorizes `open(cap, payTo, expiry)`; the facilitator calls
`settle(actual)` exactly once; the contract enforces recipient binding, the cap,
single settlement, and remainder release. Strong guarantees; the costs are a new
on-chain component (deployment, per-invocation fees, rent/TTL for session state) and a
contract audit — the exact scope v1 deliberately avoided (THREAT-MODEL §4).

**Design B — contract-free, weaker trust model, stated.** Allowance to the
facilitator, off-chain accounting, receipts. The buyer trusts the facilitator, within
the allowance window, not to over-settle and not to redirect. Mitigations are real but
partial: short expiration ledgers bound exposure in time; small caps bound it in
value; every settlement is publicly auditable after the fact. This is honest as an
interim scheme only if the spec text prints the trust model in the buyer's view.

**Composition with smart-account spending policies.** Soroban's `__check_auth` lets an
account contract impose its own authorization policy; the spec's auth-entry signing
already contemplates both classic keypairs and custom accounts, though walras has not
yet traced contract-account signature semantics end to end (Q-009, PARTIAL). A
spending-policy account that enforces per-recipient and cumulative-amount rules
natively would let an agent's *wallet* carry the budget guarantee, composing with
either design above rather than competing with them. The pre-build's client-side spend
cap (D-030) is the application-layer sketch of the same idea.

Our position: propose Design A as the scheme's normative core, with Design B
documented as an explicitly weaker-trust profile — and validate both against the
spec's own requirement that recipient binding and single settlement be guaranteed.

## 9. Operations and economics

There is no token. walras is infrastructure priced in the assets it moves — nothing in
this design mints, stakes, or requires a new asset.

**Topologies.** The same codebase runs three ways
([`deployment-topologies.svg`](../diagrams/deployment-topologies.svg)): hosted (one
operator, many sellers, one shared catalog — the topology every EVIDENCE transcript
runs); self-hosted (`git clone`, one required secret, the
[runbook](../runbook.md) — made real by the permissive license and copyleft-free
dependency path, F-060); and self-facilitation embedded inside a resource server,
which is planned — the seam exists but no packaged embedding mode ships yet
(ARCHITECTURE §6.3).

**Fees, stated as the RFP asks.** Network fees are sponsored by the facilitator's
submitter accounts — the buyer needs only the payment asset (F-006) — at a measured
cost to the operator of 22 973 stroops per settlement (F-069). Service fees are a
separate axis: `FEE_MODE` is an explicit configuration enum whose only implemented
value is `free`, so a future fee is a named, self-hoster-changeable setting rather
than a hard-wired behavior — the RFP's configurability requirement, satisfied in the
config surface today. The business model of the hosted instance: testnet is free and
stays free; mainnet pricing is an operator decision we have deliberately not made yet,
and any hosted fee will land as a documented `FEE_MODE` value that self-hosters can
decline to enable. Caller authentication, metering, and rate limiting are likewise
operator-configurable surface — planned, with the RFP's own framing that the mechanism
is the respondent's design choice ([`rfp.md`](../rfp.md) §3.1).

## 10. Security posture and audit plan

The system's security case rests on inherited, tested validation rather than novel
cryptography: the scheme's MUST list on the payment path (F-035), simulation as the
control against forged authorizations (F-062), structural replay resistance (F-039,
D-011), and the ownership-bound catalog boundary (D-024). The full STRIDE-lite
inventory — including the disclosed residuals: micro-settlement spam economics, URL
squatting, and the inherited two-ledger expiry tolerance — is
[`THREAT-MODEL.md`](../THREAT-MODEL.md), and each row links the negative test or
transcript that exercises it (EVIDENCE S1-4, S2-6, S3-4, S5-3, S6-2).

The audit plan follows RFP 3.6: v1 ships no new Soroban contract, so the engagement is
a third-party review of an offchain service and its cryptographic validation —
settlement path, auth-entry handling, discovery trust boundary — via the Audit Bank,
before any mainnet production tag. Until that review lands, walras describes itself as
unaudited testnet software everywhere it speaks, including its
[`SECURITY.md`](../../SECURITY.md).

## 11. Conformance discipline

The RFP screens for drift, and drift is a process problem, so the answer is process:

- **Wire-level acceptance, stock clients only.** The conformance claims in this paper
  are an unmodified `@x402/fetch` buyer and `@x402/express` seller completing a live
  settlement through walras (F-066, EVIDENCE S2-2), and the protocol repo's own e2e
  suite run against walras as an external facilitator — 4/4 scenarios (F-067, EVIDENCE
  S2-4). Nothing under test was patched; two harness defects found on the way are
  recorded and queued upstream rather than silently worked around (F-068, D-019,
  D-020).
- **A pinned spec and a fact ledger.** Every protocol claim traces to
  [`FACTS.md`](../FACTS.md) with status, date, and source at the pinned SHA; conflicts
  between spec and SDK become DECISIONS entries with the resolution and the upstream
  report (D-002). Where a Session-0 reading was wrong — the v1-vs-v2 header names —
  the correction is recorded, not overwritten (F-065, D-018).
- **Drift breaks the build.** The inherited reason-code enumeration is asserted
  against the *installed* upstream bundle (F-063); a duplicate `@stellar/stellar-sdk`
  in the tree fails CI (D-013); generated docs (OpenAPI, config, errors, ERD) are
  regenerated and diffed in CI so documentation cannot silently diverge from code
  (ARCHITECTURE §11).
- **Tracking a moving standard.** The observed velocity — three minor SDK versions in
  two days (F-061) — sets the posture: re-pin, re-verify the affected FACTS rows, and
  ship conformance updates as a routine, with the search-eval harness gating ranking
  changes by number rather than impression.

## 12. Roadmap and limitations

Roadmap, in dependency order and without dates: mainnet operation behind the audit;
the `upto` Stellar scheme specification upstreamed, then implemented (§8); the
channel-account submitter pool for bursty load (ARCHITECTURE §5); configurable caller
authentication, rate limiting, and catalog retention; packaged self-facilitation;
search ranking upgrades gated by the eval harness; catalog federation across
independent walras instances.

**Limitations — current, explicit:**

- **Unaudited.** No third-party security review has occurred (§10).
- **Testnet only.** Every settlement, transcript, and number in this paper is
  `stellar:testnet`; `stellar:pubnet` is configuration-supported (F-004) but has never
  been exercised by walras.
- **Baseline search.** Lexical BM25 with known, recorded failure modes on
  vocabulary-gap queries (EVIDENCE S4-3); no semantic retrieval yet.
- **Single-submitter evidence.** The fee-bump posture is captured live — five
  settlements with a decoupled fee account at exactly the predicted 100-stroop
  premium (D-021, EVIDENCE S7-1) — but every observed run still used one submitter;
  round-robin across multiple submitter seeds remains configuration-only, not yet
  observed live.
- **No `upto`.** Section 8 is design, not implementation (F-005).
- **Open surface.** No caller authentication or rate limiting yet; the
  micro-settlement spam residual and URL squatting are disclosed in
  [`THREAT-MODEL.md`](../THREAT-MODEL.md) §2.
- **No retention policy.** Nothing prunes stale listings yet (F-012 records the
  reference operator's 30-day policy; walras has not committed to a number).
- **Experimental storage module.** The catalog rides Node's built-in `node:sqlite`,
  which is upstream-experimental — an accepted, recorded risk (D-023, F-070).
- **Contract accounts untraced.** Custom `__check_auth` signature semantics are not
  yet verified end to end (Q-009, PARTIAL).

## 13. References

**Protocol, at the pinned commit `x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`:**
`specs/x402-specification-v2.md` (facilitator surface §7, discovery shapes §8);
`specs/schemes/exact/scheme_exact_stellar.md` (payload, verification MUSTs, fees);
`specs/extensions/bazaar.md` (discovery extension, validation rules, endpoints);
`specs/transports-v2/http.md` (v2 header names); `specs/transports-v2/mcp.md` (MCP
transport); `specs/schemes/upto/scheme_upto_{evm,svm}.md` (the upto gap, F-005).

**This repository:** [`FACTS.md`](../FACTS.md) — the fact ledger this paper cites as
F-001…F-085; [`DECISIONS.md`](../DECISIONS.md) — divergence log D-001…D-031;
[`EVIDENCE.md`](../EVIDENCE.md) — transcripts S0-1…S6-3 and the accounts appendix;
[`ARCHITECTURE.md`](../ARCHITECTURE.md), [`MODELS.md`](../MODELS.md),
[`THREAT-MODEL.md`](../THREAT-MODEL.md); the generated
[`api/openapi.yaml`](../api/openapi.yaml), [`reference/config.md`](../reference/config.md),
[`reference/errors.md`](../reference/errors.md); [`rfp.md`](../rfp.md) — the RFP text
this design answers, captured verbatim.

**FACTS row index by section:** §3 — F-004, F-006, F-007, F-008, F-034, F-041, F-052,
F-054, F-069; §4 — F-033, F-035…F-039, F-044, F-045, F-047, F-055, F-062, F-063,
D-007, D-008, D-011, D-012; §5 — F-013, F-023, F-024, F-027, F-029…F-032, F-042,
F-072, F-075, D-001…D-005, D-009, D-010, D-014, D-022, D-024, D-025; §6 — F-026,
F-028, F-076, F-077, D-006, D-026, D-027; §7 — F-078…F-083, D-028…D-030; §8 — F-005,
Q-009; §11 — F-061, F-065…F-068, D-013, D-018…D-020.
