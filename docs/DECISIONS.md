# DECISIONS.md — walras

ADR-lite log. One entry per decision where the pinned spec, the reference SDK, the
reference operator, or the RFP disagree — or where we deliberately exceed a spec MAY.

Every entry cites a FACTS row. Decisions are dated; superseding entries link back.
Pinned spec commit for all §Evidence references: `x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`.

Status legend: **ADOPTED** (binding on implementation) · **PROVISIONAL** (revisit before S3/S4) · **UPSTREAM** (report to x402-foundation).

---

## D-001 — List returns `items`, search returns `resources`. Both, exactly.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-027

`bazaar.md` describes the search response as "mirror[ing] the list endpoint with a `resources`
array", which reads as though both endpoints share a shape. They do not. The TypeScript wire
types are unambiguous: `DiscoveryResourcesResponse.items` for `GET /discovery/resources`,
`SearchDiscoveryResourcesResponse.resources` for `GET /discovery/search`. The v2 spec's §8.1
example and the reference e2e catalog agree with the types.

**Decision:** implement the asymmetry exactly as the SDK types define it. A stock `withBazaar`
client would silently read `undefined` if we normalized both to one name — the failure would be
an empty result list, not an error, which is the worst kind of conformance bug.

---

## D-002 — `lastUpdated`: the spec and the SDK contradict each other. Follow the SDK.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-050 · **Also UPSTREAM**

A direct conflict at the same commit:

| Source | Type | Value |
|---|---|---|
| `specs/x402-specification-v2.md` §8.3 | "Unix timestamp" | `"lastUpdated": 1703123456` (number) |
| `extensions/src/bazaar/facilitatorClient.ts` L108 | `lastUpdated: string` | "ISO 8601 timestamp of when the resource was last updated" |

Nothing at the pinned SHA reconciles these. The reference e2e catalog stores whatever it is
handed, so it does not disambiguate.

**Decision:** emit the **ISO 8601 string**, because the SDK type is what a stock client compiles
against and the RFP's acceptance test is "reviewers point stock SDK code at the deliverable"
(RFP 3.6). A number would fail type expectations in TypeScript consumers.

**Upstream:** file an issue against x402-foundation/x402 noting the spec/SDK conflict. This is
exactly the class of interop bug report the RFP names as a strong signal (RFP §4, "Conformance
discipline"). Track the outcome; if the spec wins, this entry is superseded.

---

## D-003 — Implement full cursor pagination even though the spec makes it advisory.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-026, F-028, F-013

The spec marks `limit` and `cursor` as advisory ("facilitator may return fewer or ignore") and
`pagination` as optional. Every reference implementation takes that latitude: CDP's search has no
pagination at all, and the reference SDK catalog returns `partialResults: false, pagination: null`
unconditionally. The RFP, by contrast, requires "cursor pagination and the `partialResults` flag"
(RFP 3.2) as a deliverable.

**Decision:** implement real cursor pagination and a truthful `partialResults`. This is deliberate
over-delivery against the spec's MAY, driven by the RFP's MUST. It is also a differentiator —
F-013 establishes that no reference operator currently does it.

**Constraint:** search pagination is `{limit, cursor}` only. It has no `offset` or `total`, unlike
list pagination `{limit, offset, total}`. Do not add fields the wire type does not carry.

---

## D-004 — Catalog only after successful settlement. This is our policy, not conformance.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-023, F-010

The pre-build plan treated settle-gated cataloging as spec behavior. It is not. `bazaar.md`
§Facilitator Behavior requires only validate-then-extract and explicitly says "How a facilitator
stores, indexes, and exposes discovered resources is an implementation detail." Settle-gating is
CDP's observed behavior (F-010), not a normative requirement.

**Decision:** keep settle-gating — a listing should cost a real payment, which is the anti-spam
property the demo narrates. But **describe it accurately** in the submission as a design choice
with a rationale, never as conformance. Claiming spec-mandated behavior that isn't would be
exactly the kind of imprecision the RFP screens for.

---

## D-005 — `/discovery/resources` takes seven filters. The RFP lists six.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-025

RFP 3.2 enumerates `type`, `payTo`, `network`, `extensions`, `limit`, `offset`. The spec and the
SDK client also define **`scheme`** (e.g. `exact`). The omission is in the RFP's prose, not the spec.

**Decision:** implement all seven, including `scheme`, plus the spec's documented defaults
(`limit` = 20, clamped 1–100; `offset` = 0). Note the discrepancy in the submission — it
demonstrates the spec was read at source rather than paraphrased from the RFP.

---

## D-006 — The search parameter is `query`. Correct the plan's `q`.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-026

The pre-build testing doc §4 scripts the demo as `GET /discovery/search?q=...`. The spec, the v2
spec's example, and `facilitatorClient.ts` L283 all use **`query`**. A stock `withBazaar` client
sends `query`; a server reading `q` returns nothing and looks broken.

**Decision:** `query` everywhere. Fix the demo script before S5. Consider accepting `q` as an
undocumented alias purely to make a hand-typed curl forgiving, but never emit or document it.

---

## D-007 — Inherit the package's 37 reason codes; never invent a parallel taxonomy.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-045

`ExactStellarScheme` already emits machine-readable codes on every rejection path — 30 on verify,
7 on settle. Verify:
`invalid_x402_version`, `unsupported_scheme`, `network_mismatch`, `invalid_network`,
`invalid_exact_stellar_payload_malformed`, `_wrong_operation`, `_unsafe_tx_or_op_source`,
`_wrong_asset`, `_wrong_function_name`, `_facilitator_is_payer`, `_wrong_recipient`,
`_wrong_amount`, `_simulation_failed`, `_fee_exceeds_maximum`, `_event_not_transfer`,
`_event_missing_contract_id`, `_event_wrong_asset`, `_no_transfer_events`, `_multiple_transfers`,
`_event_wrong_from`, `_event_wrong_to`, `_event_wrong_amount`, `_no_auth_entries`,
`_unsupported_credential_type`, `_facilitator_in_auth`,
`invalid_exact_stellar_signature_expiration_too_far`, `_has_subinvocations`,
`_missing_payer_signature`, `_unexpected_pending_signatures`, `unexpected_verify_error`.
Settle adds: `verification_failed`, `settle_exact_stellar_signer_selection_failed`,
`_transaction_signing_failed`, `_fee_bump_signing_failed`, `_transaction_submission_failed`,
`_transaction_failed`, `unexpected_settle_error`.

**Decision:** pass these through verbatim. Our own codes are namespaced separately and used only
where the package is silent — caller auth, rate limiting, and cataloging outcomes. The RFP's
"non-null `reason` on every rejection" (RFP 3.6) is then satisfied by construction on the payment
path, and only our added surface needs new coverage.

---

## D-008 — We inherit a 2-ledger expiry tolerance that the spec does not grant.
**Status:** PROVISIONAL · 2026-08-02 · Evidence: F-046

The spec says the auth-entry expiration ledger **MUST NOT** exceed `currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds)`. The package accepts up to `maxLedger + 2`
(`SIGNATURE_EXPIRATION_LEDGER_TOLERANCE = 2`), to absorb RPC ledger skew.

**Decision:** accept the package behavior rather than fork — the plan's rule is "wrap, don't fork",
and a stricter wrapper would reject payloads the reference client legitimately produces. **But
disclose it**: the submission should not claim strict spec compliance on expiry without this
footnote. Revisit if the `--expired` negative test (S5) behaves surprisingly near the boundary.

---

## D-009 — The reference e2e catalog violates the spec's MCP keying MUST.
**Status:** UPSTREAM · 2026-08-02 · Evidence: F-029, F-027

`bazaar.md` states facilitators **MUST** key MCP resources on the tuple
(`resource.url`, `input.toolName`), because MCP multiplexes many tools over one endpoint. The
reference implementation at `e2e/facilitators/typescript/bazaar.ts` L17 does
`this.discoveredResources.set(resource.resource, resource)` — keyed on URL alone. Two MCP tools on
the same server therefore overwrite each other.

**Decision:** key correctly on the tuple in walras. Report the reference-implementation bug
upstream with a minimal reproduction. Prior interop bug reports are explicitly called out as a
strong evaluation signal (RFP §4).

---

## D-010 — The public conformance baseline does not advertise Bazaar at all.
**Status:** ADOPTED (framing) · 2026-08-02 · Evidence: F-042

The RFP names x402.org as the conformance baseline and says "any behavior this RFP requires should
be verifiable by pointing the same stock client at both it and the deliverable." Live capture shows
x402.org advertises `extensions: ["builder-code","eip2612GasSponsoring","erc20ApprovalGasSponsoring"]` — **no `bazaar`**, and no `stellar:pubnet` kind.

**Decision:** for the payment path, x402.org remains the differential baseline and any divergence
is our bug. For the discovery path there is **no baseline to diff against** — we must be conformant
to the spec text and the SDK types directly (D-001, D-002, D-003). Say this plainly in the
submission: it is the RFP's own "advertised vs reachable support" point, evidenced.

**Corollary:** walras should list `bazaar` in its own `/supported.extensions`, which would make it
the reachable Stellar Bazaar the RFP asks for.

---

## D-011 — Replay resistance is structural. Do not claim it as a coded check.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-039

RFP 3.1 requires payloads be "not replayed". Neither the spec's MUST list nor the package contains
an explicit replay branch. Protection is structural: a Soroban auth-entry nonce is consumed
on-chain at first settlement, so re-simulation of a replayed payload fails — and simulation success
is itself a MUST (F-035), plus the expiry bound caps the window.

**Decision:** describe replay resistance accurately as *enforced by Soroban nonce consumption,
surfaced through mandatory re-simulation*, and **demonstrate it empirically** with the `--replay`
negative test capturing the actual reason code. Do not write a redundant application-level replay
cache for the pre-build; if one is added later it is defence-in-depth, not the primary control.

---

## D-012 — Revise "single submitter account": the package already ships the throughput answer.
**Status:** SUPERSEDES plan §6.8 · 2026-08-02 · Evidence: F-047, F-055

The plan proposed a single submitter for the pre-build with channel accounts merely *documented* as
the production design. Two findings change this. The package exposes `feeBumpSigner`, which wraps
the inner transaction in a `FeeBumpTransaction` so fee payment is decoupled from sequence-number
management. And the reference operator **already runs this in production** — its settlements show
`source_account` ≠ `fee_account`, with two signers advertised and round-robin selection in the
package.

**Decision:** configure walras with multiple signers plus a `feeBumpSigner` from the start. It is
configuration, not engineering, and it converts RFP 3.5's throughput question from a paragraph of
intent into a demonstrated property with a matching on-chain reference.

---

## D-013 — Pin `@stellar/stellar-sdk` to `^16`.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-059

`@x402/stellar@2.20.0` depends on `@stellar/stellar-sdk: ^16.0.1`, and its settle path is written
against v16 fee semantics ("SDK v16: `fee` is the inclusion buffer only; build() adds
sorobanData.resourceFee()"). A `^14` pin in our own manifest silently produced two SDK copies in the
tree (14.6.1 and 16.2.0).

**Decision:** pin `^16` in every workspace package. Add a CI assertion that exactly one
`@stellar/stellar-sdk` resolves in the tree — a duplicate here would produce XDR objects that fail
`instanceof` checks across the boundary, which is a miserable class of bug to debug.

---

## D-014 — `rejectedReason` is human-readable by spec; carry a machine code alongside.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-024

The spec types `bazaar.rejectedReason` as "Human-readable explanation". The project rule (method
item 7) and RFP 3.3 both demand machine-readable rejection reasons an agent can branch on.

**Decision:** populate `rejectedReason` with the human string the spec expects — so stock clients
render something sensible — and carry a stable machine code in an additional field alongside it
within our `bazaar` response object. Additive fields are safe: unknown keys are ignored by clients
that do not recognise them, matching how the spec already treats additive `resource` metadata.
Revisit if upstream standardizes a code field.

---

## D-015 — Cataloging must never block settlement (unchanged, now with a mechanism).
**Status:** ADOPTED · 2026-08-02 · Evidence: F-051, F-024

Reaffirming plan §6.2 with the specific mechanism now known: `extractDiscoveryInfo` never throws —
it `console.warn`s and returns `null` on validation failure — so the soft-drop path is already the
package's default. `EXTENSION-RESPONSES` is a **MAY**, so omitting it on indexer failure is
conformant.

**Decision:** the settle response is produced and returned from the chain result alone. Cataloging
runs off that path, and its outcome only ever decorates the response with a header. A broken indexer
degrades discovery and never payments. Add a test that asserts settlement succeeds while the
catalog store is forced to fail.

---

## D-016 — Do not advertise `bazaar` in `/supported.extensions` until it is reachable.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-042 · Refines D-010

D-010's corollary says walras "should list `bazaar` in its own `/supported.extensions`, which
would make it the reachable Stellar Bazaar the RFP asks for". Session 1 ships the payment
endpoints only — no catalog, no discovery endpoints. Listing `bazaar` now would advertise an
extension with nothing behind it.

That is precisely the failure D-010 criticises x402.org for the inverse of: the RFP's
"advertised vs reachable support" caution cuts both ways, and over-advertising is the worse
direction because a client that believes the advertisement gets a 404 rather than a considered
fallback.

**Decision:** `extensions: []` while no extension is implemented; register `BAZAAR` and let it
appear in `/supported` in the same change that mounts `GET /discovery/resources`. The
`/supported` test asserts the empty array today so the omission is deliberate and visible,
rather than an oversight nobody notices.

---

## D-017 — Test the payment path against a Soroban RPC double, and label its results as modelled.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-035, Q-011

`ExactStellarScheme` orders its checks so that expiry bounds, signature status,
sub-invocations, and transfer-event validation all run *after* `simulateTransaction`
succeeds. Simulation cannot succeed against live testnet until a buyer holds testnet USDC —
the one thing Q-011 is blocked on. Run against the real network, every negative fixture
collapses into the same `invalid_exact_stellar_payload_simulation_failed`, and a green suite
would demonstrate nothing about the codes past that point.

The alternative to a double is to assert only what is reachable pre-simulation, which leaves
the tampered-payload case — the one the session's own acceptance criteria names — untested.

**Decision:** run the fixture suite against an in-process JSON-RPC double that verifies
auth-entry signatures against the real CAP-46 preimage and synthesizes transfer events from
the transaction actually submitted. **Label every result obtained through it as modelled, not
observed on-chain**, in EVIDENCE and in the code. It is not a Soroban VM: no balances, no
footprints, no nonce consumption — so it can never substitute for the live round-trip Q-011
still requires. Retire nothing on its evidence; when Q-011 closes, the same fixtures should be
replayed against live RPC and the results compared.

**S2 follow-up:** Q-011 closed and the live replay happened (EVIDENCE S2-6). Live results
match the double's predictions exactly where the two overlap: `wrong_amount` fires
pre-simulation, and both the replayed and the expired payload collapse to
`…_simulation_failed` live — confirming that the double remains the only way to exercise
the post-simulation codes (F-064). The double is vindicated, not retired.

---

## D-018 — The v2 wire headers are `PAYMENT-*`. F-057 was a v1 reading.
**Status:** ADOPTED (FACTS correction) · 2026-08-02 · Evidence: F-065, EVIDENCE S2-2

Session 0 recorded (F-057) the request header as `X-PAYMENT` and the receipt as
`X-PAYMENT-RESPONSE`, sourced from `x402HTTPClient.ts` L98/L151. The live S2 transcript —
stock client on both sides — used `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and
`PAYMENT-RESPONSE`. Re-reading the same file shows a version switch F-057 missed:
`x402Version === 2` → `PAYMENT-SIGNATURE`; `x402Version === 1` → `X-PAYMENT`. The pinned
spec (`specs/transports-v2/http.md` §Header Reference) names the `PAYMENT-*` triple as the
canonical v2 transport, and `X-PAYMENT-RESPONSE` survives only as the client's v1 fallback
read.

**Decision:** F-065 supersedes F-057; F-057 stays in FACTS marked superseded, scoped to v1.
No code changes anywhere — the facilitator never sees these headers (they are
client↔seller transport), and both stock sides already conform. The lesson recorded: a
FACTS row sourced from code must capture the *dispatch condition*, not just the string at a
line number.

---

## D-019 — The e2e mock facilitator breaks its own contract; one-line scaffolding fix.
**Status:** UPSTREAM · 2026-08-02 · Evidence: F-068, EVIDENCE S2-4

The e2e harness boots a mock facilitator whose documented purpose is to "claim to support
all schemes/networks" so servers whose routes exceed the real facilitator's kinds can still
start. At the pinned SHA its `evmSchemes` is `["exact", "upto"]` — no `batch-settlement` —
while every TypeScript e2e server configures `batch-settlement` EVM routes unconditionally.
Any external facilitator that is not a full EVM facilitator therefore kills the server with
`RouteConfigurationError` before a single payment runs. The bundled reference facilitator
masks the bug by supporting `batch-settlement` itself.

**Decision:** fix the scaffolding locally (add `"batch-settlement"` to `evmSchemes` —
one line, aligning the mock with its own stated contract) and report upstream with the
reproduction. The stop-condition line is drawn explicitly: mock scaffolding may be aligned
with its documented contract; **stock clients, servers, SDK packages, and the facilitator
under test are never patched**. Without this fix the suite cannot evaluate *any*
single-family external facilitator — precisely walras's category — so the fix is a
precondition of the RFP's own acceptance path, not a convenience.

---

## D-020 — The fastify e2e server cannot run against single-family facilitators. Excluded, not patched.
**Status:** UPSTREAM · 2026-08-02 · Evidence: F-068, EVIDENCE S2-4

`servers/express`, `servers/hono`, and `servers/next` all read `MOCK_FACILITATOR_URL` and
attach the mock as a fallback facilitator client. `servers/fastify/index.ts` never
references it, so its route validation sees only the real facilitator's kinds and throws
for every non-EVM operator — both stock clients failed against it with the same
server-side 500 while express and hono passed 4/4 (matrix run recorded in S2-4).

**Decision:** exclude fastify from the S2 matrix rather than wire the mock into it. Unlike
D-019's mock, the fastify server is a component under test — patching it would change what
the suite measures. Report upstream alongside D-019 (same root theme: the external-proxy
path is under-exercised because CI always runs the all-family reference facilitator).

---

## D-021 — S2 ran single-signer without fee-bump; the measured cost of that choice is exactly 100 stroops.
**Status:** PROVISIONAL · 2026-08-02 · Refines D-012 · Evidence: EVIDENCE S2-3

D-012 adopted "multiple signers plus a `feeBumpSigner` from the start". Session 2
deliberately ran the minimal posture instead — one submitter, `FEE_BUMP_SECRET` unset — so
the first live round-trip had the fewest moving parts. Two consequences, both now measured:
`source_account == fee_account` on every walras settlement (baseline: decoupled, F-055),
and `fee_charged` = 22 973 stroops vs the baseline's 23 073 — a delta of exactly one
base-fee unit, which is the fee-bump operation's own fee. Nothing about the wire protocol
differs; the fee-bump is spec-optional.

**Decision:** stand up the fee-bump account and a second submitter as configuration before
S3's throughput demonstration (the knob shipped in S1 and is unit-tested; EVIDENCE
"Not yet captured" tracks it). D-012's substance is unchanged — this entry records that S2
knowingly deferred it and what deferring it cost: 100 stroops per settlement, in the
operator's favour.

**S7 follow-up (2026-08-05):** captured. A fee account was created and funded, and the
full demo ran through the fee-bump path — five settlements, exit 0 (EVIDENCE S7-1).
Horizon shows `fee_account ≠ source_account`, `fee_charged` 23 073 / `max_fee` 33 253 —
the predicted 100-stroop delta measured exactly, and byte-identical to the baseline
operator's fee anatomy (F-054, F-055; F-086). The half of D-012 still not observed
live is round-robin across multiple submitter seeds.

---

## D-022 — Manual registration endpoint: skipped for the pre-build.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-023, F-010

The spec treats how resources enter the catalog as an implementation detail, and the
ecosystem's primary path — the one CDP demonstrates and the one that carries the anti-spam
property — is settle-gated automatic cataloging (D-004). A manual registration endpoint is
at most a secondary convenience, it has no spec shape to conform to, and it would dilute
the demo's central claim: **settlement IS registration**. Every listing in the walras
catalog exists because a real payment settled on-chain.

**Decision:** no manual registration endpoint in the pre-build. Revisit for the funded
build only if operator experience shows sellers need a pre-payment preview of their own
listing (a validation dry-run endpoint would then be the right shape, not a write path).

---

## D-023 — Catalog storage is Node's built-in `node:sqlite`, experimental flag accepted.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-070, F-060

Options were `better-sqlite3` (MIT, native build) or the built-in `node:sqlite`
(`DatabaseSync`). The built-in wins on every axis that matters here: zero added
dependencies (the license surface stays exactly as F-060 scanned it), no native
compilation in CI or on reviewer machines, and a synchronous API that fits the
settle-hook's bounded-work invariant. The cost: the module emits `ExperimentalWarning`
on the pinned Node v24.14.0 and its API could shift in future Node majors.

**Decision:** `node:sqlite`, WAL journal mode, `busy_timeout` 100 ms. The store is a
single class behind an interface-shaped surface (`packages/bazaar/src/store.ts`); if the
experimental API breaks or the funded build needs Postgres, the swap is contained to one
file. The warning is visible in test output on purpose — suppressing it would hide the
risk this entry records.

---

## D-024 — Listing identity: (resource, type, toolName), owned by the first settled payTo.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-029, F-035, F-072; EVIDENCE S3-2, S3-4

The catalog key is the spec's tuple — `(resource URL, type, toolName)`, with `toolName`
empty for HTTP (F-029). Identity binding is ours to design, and everything echoable in
the payload is client-controlled (F-072), so the ONLY trustworthy identity signal in a
settle-gated catalog is `paymentRequirements.payTo`: the scheme verified the on-chain
transfer actually credits it (F-035), and settlement proved the payment was real.

**Decision:** the first successfully indexed settlement binds the listing to its payTo.
Same key + same payTo → refresh (latest settlement wins on metadata; accepts accumulate
deduped). Same key + different payTo → `bazaar_listing_owned_by_other_payee`, nothing
written, transactionally (BEGIN IMMEDIATE around check-and-write). Proven live: a real
settled payment to the wrong payee could not touch the listing (S3-4).

**Recorded limitations, deliberate for the pre-build:** (a) a seller that rotates its
payTo cannot update its old listing — operational answer deferred to the funded build
(likely: any payTo already present in the listing's accepts set may rotate it);
(b) URL squatting remains possible — an attacker can pay to catalog a URL it does not
control *before* the real owner ever settles, because nothing proves URL control at
index time. The catalog's `accepts` is advisory; actual payments always follow the live
402 from the resource server itself, so a squat pollutes metadata but cannot redirect
funds of a buyer that follows the protocol. Same exposure exists in the reference
ecosystem; candidate for an upstream note.

---

## D-025 — Header outcome semantics: `rejected` means the client's payload; walras faults omit the header.
**Status:** ADOPTED · 2026-08-02 · Evidence: F-024, F-073; EVIDENCE S3-2

The spec gives three statuses. walras emits two: `success` (validated and written) and
`rejected` (client-attributable soft-drop, always with `rejectedReason` + additive machine
`code` per D-014 — both within the stock client's log allowlist, F-073). `processing` is
never emitted because walras never catalogs asynchronously: the indexing work is
synchronous and structurally bounded (64 KiB extensions cap before Ajv touches anything;
100 ms DB busy timeout), which is how D-015's "small budget" is enforced rather than
promised. An **internal** indexer fault emits no header at all — the header is a MAY
(F-024), and reporting a walras bug as `rejected` would tell the seller to go fix a
payload that is fine. The settle response body is never touched by any of this.

**Decision:** two statuses + omission, exactly as above; the D-015 forced-failure test
pins the omission path. Revisit `processing` only if the funded build moves indexing off
the request thread.

---

## D-026 — Search ranking is a labeled BASELINE: FTS5/BM25, lexical only, behind a one-method seam.
**Status:** ADOPTED · 2026-08-03 · Evidence: F-076; EVIDENCE S4-2, S4-3

The RFP asks for natural-language search *and* for how result quality will be evaluated
over time. The honest pre-build answer is a deliberately simple retriever plus the
harness that measures it — not a sophisticated-looking ranker with no measurement. The
pre-build DO-NOT list also forbids embedding/vector dependencies outright.

**Decision:** one `Retriever` implementation, labeled BASELINE in code and docs:
SQLite FTS5 with BM25 (built into `node:sqlite`, zero added dependencies — F-076) over
four weighted fields: service name (4.0), description (2.0), parameter text (1.0), tags
(3.0). Weights are rule-of-thumb, explicitly untuned. Parameter text is parameter NAMES
plus JSON-Schema `description` annotations extracted from the echoed bazaar extension;
example VALUES are excluded (an example city of "Zurich" says nothing about what a
resource does). Untrusted queries are compiled to quoted-token OR expressions because raw
FTS5 MATCH syntax throws (F-076); OR over AND so filler words cannot veto results — BM25
still ranks multi-term matches first. No stemming, no stopwords, no synonyms: the eval
set deliberately includes queries that fail on each gap, and those failures — recorded in
EVIDENCE S4-3 — are the measured motivation for the GRANT-scope upgrades
(ARCHITECTURE §7.3). The FTS index is maintained in the same transaction as the catalog
row and backfilled on open for pre-search databases, so the index can never drift from
the catalog.

---

## D-027 — Search pagination: real keyset cursor, integrity-bound; `partialResults` means exactly "matches were truncated".
**Status:** ADOPTED · 2026-08-03 · Evidence: F-026, F-028, F-013; EVIDENCE S4-4

D-003 committed to real cursor pagination against the spec's advisory MAY. The mechanics:

- **Cursor** = base64url JSON `{v, h, s, i}`: format version, a hash binding the cursor
  to its (query, filters) context, and the keyset position (score, id) of the last row
  seen. Keyset, not offset — under a static catalog a walk visits every match exactly
  once. IEEE doubles round-trip JSON exactly, so the score comparison is precise. The
  binding hash turns a cursor replayed against a different query into a named 400
  (`walras_invalid_search_cursor`) instead of a silently wrong page; it is integrity
  against confusion, not secrecy.
- **`partialResults`** is emitted explicitly on every response and is `true` exactly when
  matches were truncated from it (F-028): a further page exists, or retrieval hit the
  `MAX_SEARCH_RETRIEVE` cap (1000) — in the capped case it stays `true` through the last
  page, because claiming completeness there would be false.
- **`pagination.limit`** is the count of results in THIS page — the spec's literal
  reading ("Number of results in this page"), not the requested maximum, which differs
  from the list endpoint's semantics.
- **`limit`** reuses the list defaults (20, clamped 1–100, F-025) since the spec assigns
  search no bounds of its own; `query` is required and named `query` (D-006), with a
  dedicated 400 (`walras_missing_search_query`) whose text points hand-typed `q=` callers
  at the right name.

## D-028 — MCP tool errors: never throw; dual-format `{errorCode, reason}` results, facilitator codes passed through verbatim.
**Status:** ADOPTED · 2026-08-05 · Evidence: F-078 … F-080; EVIDENCE S6-2, S6-3

The RFP's "non-null machine-readable reason on every rejection" crosses the MCP
boundary intact:

- A domain failure is a **tool result** with `isError: true`, never a thrown
  JSON-RPC error: `structuredContent` = `{errorCode, reason}` and `content[0].text` =
  the JSON-stringified same object. The dual format is the transport spec's own rule
  for 402s (F-079) applied to every result, success included, so a client sees one
  contract regardless of structured-content support. Determinism is asserted in tests:
  identical calls → identical bytes.
- `errorCode` reuses the facilitator's taxonomies (D-007) **verbatim** whenever the
  rejection originated there — a discovery-envelope code from a search 400, or a
  scheme code arriving in a settle receipt's `errorReason` (checked against the
  facilitator's own `ALL_REASON_CODES` export, so upstream drift breaks the build,
  not the passthrough). Codes prefixed `walras_mcp_*` cover only the surface this
  server owns: argument validation, id resolution, reachability, spend policy,
  unsettled payments. walras never mints a parallel code for a rejection the
  facilitator already names.

## D-029 — resourceId: versioned self-describing encoding of the listing tuple; ids never outlive the catalog.
**Status:** ADOPTED · 2026-08-05 · Evidence: F-029; D-024; EVIDENCE S6-3

`id = "wr1:" + base64url(JSON [type, resource, toolName])` — the catalog identity
tuple of D-024, nothing else. Deterministic (same listing → same id on every server,
no id table to persist or replicate), self-describing (paid_call recovers the target
without a lookup service), and versioned (`wr1:` leaves room to change the scheme
without ambiguity). Two honesty rules: parsing is strict on every axis (prefix,
base64url alphabet, arity, type discriminator, http↔toolName consistency — 11
rejection cases in tests), and paid_call re-resolves the id against the live catalog
before paying, so a stale id yields `walras_mcp_unknown_resource_id` rather than a
payment to a delisted resource. The catalog stays advisory: payment terms always come
from the seller's live 402, exactly as the protocol's trust model has it.

## D-030 — Client-side spend cap, enforced twice; the MCP server pays only exact@its-network under WALRAS_MCP_MAX_AMOUNT.
**Status:** ADOPTED · 2026-08-05 · Evidence: F-081; EVIDENCE S6-2

paid_call holds an agent's wallet, so an unbounded auto-payer is the one thing it must
never be. The cap (default 10 000 000 base units = 1 USDC, F-008) binds at two layers:

- **Pre-payment check:** the probed 402's `accepts` is filtered to
  `exact@<configured network>` and its cheapest amount compared to the cap — an
  over-cap or foreign-network demand returns
  `walras_mcp_payment_declined_by_policy` with the amounts named, before anything is
  signed. On the MCP leg the same check runs in `onPaymentRequested`, aborting inside
  the stock client's own flow.
- **`registerPolicy` on the one shared `x402Client`** (F-081): the identical filter as
  a payment-requirements policy, making the bound unbypassable for every payment
  either transport could ever make — a fresh 402 with a raised price hits the policy
  even though the pre-check saw the old one. Tests assert the paying seam is never
  invoked on a declined call.

Only `CLIENT_STELLAR_PRIVATE_KEY` enables payment at all; without it the server runs
search-only and paid_call names the gap (`walras_mcp_wallet_not_configured`) — after
the probe, so free resources still work walletless.

---

## D-031 — G-LIC becomes two-tier: zero tolerance on the shipped path; reviewed, printed exceptions for docs-build tooling.
**Status:** ADOPTED · 2026-08-05 · Evidence: F-084, F-060; EVIDENCE §Docs

Installing the docs toolchain (`@mermaid-js/mermaid-cli`, MIT — pre-checked per gate
GD.3, F-084) pulled three transitive findings the original whole-tree gate hard-fails
on: `elkjs@0.9.3` (EPL-2.0), `dompurify@3.4.13` (MPL-2.0 OR Apache-2.0), and
`khroma@2.1.0` (no license field in its manifest; the package ships an MIT license
file). All three are reachable only through `@mermaid-js/mermaid-cli`, a
devDependency that executes at docs build time — `pnpm ls -r --prod --depth=Infinity`
confirms none is in any workspace project's production dependency closure.

RFP 3.6's constraint is about the deliverable: "Every dependency must be compatible
with permissive redistribution and with operating the code as a network service."
A diagram renderer that never ships and never serves is not in that path — but
loosening the gate silently would be exactly the imprecision this project screens for.

**Decision:** `scripts/license-scan.mjs` now scans in two tiers. (1) The shipped
dependency path — prod deps, transitive, of every workspace project — keeps zero
tolerance: strong copyleft, weak copyleft, and undeclared all fail. (2) Dev-toolchain
findings: strong/network copyleft still fails outright; weak-copyleft or undeclared
entries must match a pinned `name@version` exception carrying a written rationale that
is printed on every run, and khroma's MIT license file is re-verified on disk each run.
A version bump of an excepted package re-triggers review because entries pin exact
versions. Alternatives rejected: dropping rendered SVGs (R6 requires committed,
regenerable diagrams) and switching renderers (every maintained mermaid renderer
carries the same transitive tree).
