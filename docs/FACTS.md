# FACTS.md — walras (Stellar x402 facilitator + Bazaar)

Single source of truth. Rules:
- No protocol/library/API fact is asserted in code, docs, or the SCF submission unless it has a row here with **status VERIFIED**, a **date**, and a **source**.
- Web-sourced rows are re-verified against the pinned spec commit in Session 0 where applicable.
- On conflict between this file and anyone's memory: this file wins. On conflict between this file and the pinned spec: re-verify, update the row, log in DECISIONS.md.

Pinned spec commit: `x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`
(main, committed 2026-08-01T14:16:23+02:00; cloned to `/workspaces/x402` on 2026-08-02.
All `specs/…` and `typescript/…` paths below are **at that SHA**.)

RFP source text: `docs/rfp.md` (verbatim, captured 2026-08-02).
Evidence transcripts: `docs/EVIDENCE.md`. Divergence log: `docs/DECISIONS.md`.

---

## Verified — carried forward from 2026-07-31 (web-sourced)

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| F-001 | `@x402/stellar` exists on npm; **Apache-2.0**. *Version superseded — see F-040.* | VERIFIED | 2026-07-31 | npmjs.com/package/@x402/stellar |
| F-002 | Protocol repo is `github.com/x402-foundation/x402` (migrated from `coinbase/x402`) | VERIFIED | 2026-07-31 | repo README; npm package links |
| F-003 | Package provides Client / Facilitator / Server components; `ExactStellarScheme`; `createEd25519Signer` implements SEP-43 `SignAuthEntry` + `SignTransaction` | VERIFIED | 2026-07-31 | npm README; re-confirmed at SHA (F-030) |
| F-004 | Networks: `stellar:testnet` (default RPC `https://soroban-testnet.stellar.org`), `stellar:pubnet` (**custom RPC URL required**), `stellar:*` wildcard; CAIP-2; x402 v2 | VERIFIED | 2026-07-31 | npm README; re-confirmed at SHA (F-041) |
| F-005 | `@x402/stellar` implements the **exact scheme only** today → the `upto` Stellar gap in the RFP is real | VERIFIED | 2026-07-31 | npm README; re-confirmed: only `specs/schemes/upto/scheme_upto_{evm,svm}.md` exist at SHA — no Stellar variant |
| F-006 | Facilitators currently **always sponsor fees**; `areFeesSponsored: true` | VERIFIED | 2026-07-31 | npm README; re-confirmed live (F-025) and in source (F-031) |
| F-007 | Validity is **ledger-based**, ~12 ledgers ≈ 60 s. *Derivation now pinned — see F-028.* | VERIFIED | 2026-07-31 | npm README |
| F-008 | Any SEP-41 token supported; USDC default, 7 decimals; amounts in base units | VERIFIED | 2026-07-31 | npm README; **confirmed on-chain** (F-036, F-038) |
| F-009 | Bazaar is codified as an **official v2 extension** in the reference SDK | VERIFIED | 2026-07-31 | docs.cdp.coinbase.com/x402/bazaar; spec at SHA |
| F-010 | Cataloging is automatic after successful settle; no separate registration step. **CDP behavior — NOT spec-mandated.** See F-023. | VERIFIED (CDP only) | 2026-07-31 | docs.cdp.coinbase.com/x402/bazaar |
| F-011 | Cataloging outcomes reported via **`EXTENSION-RESPONSES`** header | VERIFIED | 2026-07-31 | spec at SHA (F-024); SDK source (F-039) |
| F-012 | CDP prunes resources with no settlements for 30 days | VERIFIED (CDP behavior, not spec) | 2026-07-31 | docs.cdp.coinbase.com/x402/bazaar |
| F-013 | CDP's `/discovery/search` has no pagination. **Confirmed as ecosystem-wide** — the reference SDK impl also returns `pagination: null` unconditionally (F-027). | VERIFIED | 2026-07-31 | docs.cdp.coinbase.com; `e2e/facilitators/typescript/bazaar.ts` |
| F-014 | CDP exposes the Bazaar to agents via MCP with tools shaped like `search_resources` / `proxy_tool_call` | VERIFIED | 2026-07-31 | docs.cdp.coinbase.com/x402/bazaar |
| F-015 | OpenZeppelin Relayer is AGPL-3.0; `@openzeppelin/relayer-sdk` AGPL-3.0-or-later → excluded per RFP 3.6 | VERIFIED | 2026-07-31 | github.com/OpenZeppelin/openzeppelin-relayer; npm |
| F-016 | SDF is a Premier member of the x402 Foundation with a Governing Board seat; Foundation launch 2026-07-14 | VERIFIED | 2026-07-31 | stellar.org/x402; RFP §2 corroborates |
| F-017 | x402.org facilitator supports `stellar:testnet` with sponsored fees | VERIFIED | 2026-07-31 | **confirmed live** (F-025) |
| F-018 | `stellar/x402-stellar` repo carries SDF tools, examples, reference facilitator example | VERIFIED | 2026-07-31 | developers.stellar.org; RFP appendix |
| F-019 | Freighter browser extension supports x402; Freighter Mobile does not yet | VERIFIED | 2026-07-31 | developers.stellar.org x402 docs |
| F-020 | SDK family includes `@x402/extensions` and `@x402/mcp` | VERIFIED | 2026-07-31 | confirmed on npm (F-040) |
| F-021 | `@x402/extensions` provides `bazaarResourceServerExtension` and `withBazaar` | VERIFIED | 2026-07-31 | source at SHA (F-032) |
| F-022 | Built on Stellar facilitator is built on OZ Relayer + x402 plugin (AGPL-excluded) | VERIFIED | 2026-07-31 | developers.stellar.org |

### Context facts (submission, not build)

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| C-001 | SCF FAQ: generally one project at a time per submitter | VERIFIED | 2026-07-31 | SCF Handbook FAQ |
| C-002 | Repeat Build applicants must show significant progress on prior project; reviewers assess only submission content | VERIFIED | 2026-07-31 | SCF Handbook |
| C-003 | Round deadline arrives in the SCF invitation email | VERIFIED (imprecise) | 2026-07-31 | SCF Handbook |
| C-004 | RFP Track: submissions reviewed by **2 reviewers** from the quarter's Category Delegate Panel; third breaks ties. Scope may be limited if reasoning is articulated. Q3 RFPs opened **2026-07-23** for SCF #45. | VERIFIED | 2026-08-02 | `docs/rfp.md` Part A |

---

## Verified — Session 0, from pinned spec / source / live measurement

### Bazaar extension (Q-001) — `specs/extensions/bazaar.md` @ SHA

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| F-023 | The spec does **not** require cataloging to be gated on settlement. Facilitator Behavior says only: (1) validate `info` against `schema`, (2) extract. "How a facilitator stores, indexes, and exposes discovered resources is an implementation detail." Settle-gating is our deliberate choice, not conformance. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md` §Facilitator Behavior |
| F-024 | `EXTENSION-RESPONSES` is **base64-encoded JSON keyed by extension name**. `bazaar.status` ∈ `"success"` \| `"processing"` \| `"rejected"` (required); `bazaar.rejectedReason` (optional string, human-readable, only when rejected). Facilitator **MAY** append it — it is not mandatory. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md` §Verify and Settlement Response Header |
| F-025 | `/discovery/resources` filters are **seven**, not six: `type`, `payTo`, **`scheme`**, `network`, `extensions`, `limit`, `offset`. RFP 3.2 omits `scheme`. Defaults from v2 spec §8.1: `limit` = 20 (range 1–100), `offset` = 0. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md`; `specs/x402-specification-v2.md` §8.1 |
| F-026 | `/discovery/search` query parameter is named **`query`**, not `q`. Required. Other params: `type`, `payTo`, `scheme`, `network`, `extensions`, `limit`, `cursor`. `limit` and `cursor` are explicitly **advisory** — "facilitator may return fewer or ignore". | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md`; `extensions/src/bazaar/facilitatorClient.ts` L282-304 |
| F-027 | **List and search return different array field names.** List → `items`; search → `resources`. Confirmed in three places: TS types `DiscoveryResourcesResponse.items` vs `SearchDiscoveryResourcesResponse.resources`; the reference e2e catalog; v2 spec §8.1 example. bazaar.md's prose "mirrors the list endpoint with a `resources` array" is loose wording, not a third shape. | VERIFIED | 2026-08-02 | `extensions/src/bazaar/facilitatorClient.ts` L126-159; `e2e/facilitators/typescript/bazaar.ts` L25-67 |
| F-028 | Search response fields: `partialResults?: boolean` ("true when additional matches were truncated"); `pagination?: {limit: number, cursor: string \| null} \| null`. Note search pagination has **no `offset`/`total`** — unlike list pagination `{limit, offset, total}`. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md`; `facilitatorClient.ts` L145-159 |
| F-029 | MCP resources are keyed on the tuple (`resource.url`, `input.toolName`) — facilitators **MUST** use both because MCP multiplexes tools over one endpoint. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md` §MCP Tools note |
| F-030 | `routeTemplate` validation: non-empty; starts `/`; matches `^/[a-zA-Z0-9_/:.\-~%]+$`; no `..`; no `://`. Percent-decoding **MUST** precede the `..` and `://` checks. Failure = discard field and fall back to concrete URL path (soft-drop, not rejection). Shipped as `isValidRouteTemplate`. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md` §routeTemplate Validation Rules; `extensions/src/bazaar/facilitator.ts` L31-66 |
| F-031 | Soft-drop service metadata rules apply to `resource.serviceName` / `tags` / `iconUrl` (**not** to the discovery `info` block). `serviceName`: printable ASCII U+0020–U+007E, ≤32 chars. `tags`: ≤5 entries, each ≤32 printable-ASCII chars, deduped case-insensitively, first occurrence wins. `iconUrl`: ≤2048 chars, absolute http(s) only, no userinfo, IDN-normalized (UTS #46), rejects IP literals / loopback set / all-digit / hex hostnames. Percent-decode the host **before** IP and loopback checks. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md` §Validation Rules; `extensions/src/bazaar/facilitator.ts` L83-283 |
| F-032 | Clients echo the bazaar extension from `PaymentRequired` into `PaymentPayload`. **If omitted, no cataloging occurs** — the seller cannot force a listing. | VERIFIED | 2026-08-02 | `specs/extensions/bazaar.md` §Client Behavior |

### Exact-Stellar scheme (Q-002) — `specs/schemes/exact/scheme_exact_stellar.md` @ SHA

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| F-033 | `payload` is exactly `{"transaction": "<base64 XDR>"}` — a Stellar transaction with a **single** `invokeHostFunction` op calling `transfer(from, to, amount)` plus signed auth entries. Scope is **SEP-41 Soroban tokens only; classic Stellar assets are not supported.** | VERIFIED | 2026-08-02 | spec §PaymentPayload `payload` Field, §Summary NOTE |
| F-034 | Auth-entry expiry derivation: `ledgerTimeout = ceil(maxTimeoutSeconds / estimatedLedgerSeconds)`, using the live network estimate where available, **fallback 5 s**. With the default `maxTimeoutSeconds: 60` this yields 12 ledgers — the origin of the "~12 ledgers ≈ 60 s" figure in F-007. | VERIFIED | 2026-08-02 | spec §Protocol Flow step 4, §Authorization Entries |
| F-035 | Facilitator verification MUST list has five groups: protocol (version/scheme/network), transaction structure (1 op, contract == `asset`, fn `transfer` w/ 3 args, arg1 == `payTo`, arg2 == `amount` as i128), auth entries (`sorobanCredentialsAddress` only, no `subInvocations`, all required signers signed, expiry bound), **facilitator safety** (facilitator must not be tx source, op source, `from`, or appear in any auth entry; simulation must show only the expected balance changes), and simulation (must succeed and emit events confirming the exact amount). | VERIFIED | 2026-08-02 | spec §Facilitator Verification Rules (MUST) |
| F-036 | **`/settle` MUST perform full verification independently and MUST NOT assume prior verification.** The package already honours this — `settle()` calls `_verify()` as its Step 1. Our wrapper must therefore NOT re-verify. | VERIFIED | 2026-08-02 | spec §Protocol Flow step 10 NOTE; `mechanisms/stellar/src/exact/facilitator/scheme.ts` L208 |
| F-037 | Fee rules: facilitator MUST derive the settlement fee from a **fresh settle-time simulation** (`simulationResourceFee + inclusionBuffer`, buffer ≥ 100 stroops), refresh Soroban footprint/resourceFee from that simulation, and **fully override the client's fee bid**. Optional `maxTransactionFeeStroops` ceiling, default **50 000 stroops**, rejects with `invalid_exact_stellar_payload_fee_exceeds_maximum`. | VERIFIED | 2026-08-02 | spec §Transaction Fees |
| F-038 | `SettlementResponse` = `{success, transaction, network, payer}` where `transaction` is the **64-char hex tx hash** and `payer` is the client's address (never the facilitator's). | VERIFIED | 2026-08-02 | spec §Phase 3 |
| F-039 | The spec's MUST list contains **no explicit replay check**. Replay resistance is structural: a reused Soroban auth-entry nonce makes re-simulation fail, and simulation success is itself a MUST. The package likewise has no explicit replay branch. RFP 3.1 demands "not replayed", so this must be stated as structural and demonstrated empirically, not claimed as a coded check. | VERIFIED | 2026-08-02 | spec §Facilitator Verification Rules; `scheme.ts` L493-504 (no replay branch) |

### Facilitator surface & `/supported` (Q-003, Q-005)

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| F-040 | `/supported` returns `{kinds[], extensions[], signers{}}` — **all three required**. Each kind: `{x402Version, scheme, network, extra?}`. `signers` maps CAIP-2 patterns (`stellar:*`) to public addresses. | VERIFIED | 2026-08-02 | `specs/x402-specification-v2.md` §7.3, §7.3.1 |
| F-041 | **Live capture** of `https://x402.org/facilitator/supported` returns for Stellar: `{"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}`, and `signers["stellar:*"] = ["GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K","GC5OLUZ4WANPN6VT7YGTK2SRMZG762KOVKJXHWIO4K57UBASO2FMNRET"]` (**two** signers). No `stellar:pubnet` kind is advertised. | VERIFIED | 2026-08-02 | EVIDENCE §S0-2 |
| F-042 | The x402.org facilitator advertises `extensions: ["builder-code","eip2612GasSponsoring","erc20ApprovalGasSponsoring"]` — **`bazaar` is absent.** The public conformance baseline does not advertise Bazaar support at all. | VERIFIED | 2026-08-02 | EVIDENCE §S0-2 |
| F-043 | `areFeesSponsored` is not Stellar-only: x402.org advertises `xrpl:1` with `extra.areFeesSponsored: false`, confirming it as a cross-chain field with a meaningful `false` case. | VERIFIED | 2026-08-02 | EVIDENCE §S0-2 |
| F-044 | Wrap target: `class ExactStellarScheme implements SchemeNetworkFacilitator`, imported from `@x402/stellar/exact/facilitator`. Constructor `(signers: FacilitatorStellarSigner[], {rpcConfig?, areFeesSponsored=true, maxTransactionFeeStroops=50_000, selectSigner=roundRobin, feeBumpSigner?})`. Methods: `verify()`, `settle()`, `getExtra(network)` → `{areFeesSponsored}`, `getSigners(network)`. Package exports: `.`, `./exact/client`, `./exact/server`, `./exact/facilitator`. | VERIFIED | 2026-08-02 | `mechanisms/stellar/src/exact/facilitator/scheme.ts` L85-174; package.json exports |
| F-045 | The package performs **all** of the spec's verification MUSTs itself, emitting **37 distinct machine-readable reason codes** (30 on the verify path, 7 on the settle path; enumerated in DECISIONS D-007). Our wrapper adds **zero** payment validation — its jobs are HTTP surface, config, caller auth, and the discovery hook. | VERIFIED | 2026-08-02 | `scheme.ts` L379-556, L610-804 |
| F-046 | The package tolerates auth-entry expiry **2 ledgers beyond** the spec's strict bound (`SIGNATURE_EXPIRATION_LEDGER_TOLERANCE = 2`, for RPC skew). The spec says MUST NOT exceed `currentLedger + ceil(...)`. This is an implementation deviation we inherit by wrapping. | VERIFIED | 2026-08-02 | `scheme.ts` L37, L769 |
| F-047 | Settle supports an optional **`feeBumpSigner`** that wraps the inner transaction in a `FeeBumpTransaction`, decoupling fee payment from sequence-number management — i.e. the throughput answer to RFP 3.5 is already in the package. | VERIFIED | 2026-08-02 | `scheme.ts` L106-108, L287-323 |

### Bazaar facilitator-side helpers (Q-006)

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| F-048 | **`@x402/extensions` DOES ship facilitator-side cataloging helpers** — contradicting the pre-build plan's expectation (Q-006 "Expected: our build"). Exported from `@x402/extensions/bazaar`: `extractDiscoveryInfo`, `extractDiscoveryInfoFromExtension`, `validateAndExtract`, `validateDiscoveryExtension` (Ajv 2020-12 against the supplied schema), `validateDiscoveryExtensionSpec` (protocol invariants), `isValidRouteTemplate`, `isValidServiceName`, `sanitizeTags`, `isValidIconUrl`, `sanitizeResourceServiceMetadata`. | VERIFIED | 2026-08-02 | `extensions/src/bazaar/index.ts` L108-127 |
| F-049 | What remains **our** build: persistence, indexing, the two discovery HTTP endpoints, ranking, retention, and the `DiscoveredResource` → `DiscoveryResource` wire mapping. The package stops at extraction; it never stores or serves. | VERIFIED | 2026-08-02 | `extensions/src/bazaar/facilitator.ts` (no storage); spec §Facilitator Behavior |
| F-050 | Two **distinct** types with confusingly similar names. `DiscoveredResource` (extraction output) = `{resourceUrl, description?, mimeType?, serviceName?, tags?, iconUrl?, method?\|toolName, routeTemplate?, x402Version, discoveryInfo, extensions?}`. `DiscoveryResource` (catalog wire shape) = `{resource, type, x402Version, accepts[], lastUpdated, description?, mimeType?, serviceName?, tags?, iconUrl?, extensions?}`. The mapping between them is unimplemented in the package and is ours. | VERIFIED | 2026-08-02 | `bazaar/http/types.ts`, `bazaar/mcp/types.ts`, `bazaar/facilitatorClient.ts` L98-121 |
| F-051 | `extractDiscoveryInfo` canonicalizes the catalog URL as `${origin}${routeTemplate}` when a valid `routeTemplate` is present, else `${origin}${pathname}` — query string and fragment are **stripped**. On schema-validation failure it `console.warn`s and returns `null` (soft-drop, never throws). | VERIFIED | 2026-08-02 | `extensions/src/bazaar/facilitator.ts` L504-538 |

### Toolchain, assets, fees (Q-004, Q-007, Q-008, Q-010, Q-012, Q-013)

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| F-052 | Testnet USDC SAC contract ID is `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, wrapping classic asset `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, `decimals() == 7`. **Verified four independent ways**: spec example, package constant `USDC_TESTNET_ADDRESS`, on-chain ledger entry (`executable == contractExecutableStellarAsset`, METADATA storage), and cryptographic re-derivation `Asset("USDC", issuer).contractId(TESTNET)` round-tripping to the same ID. | VERIFIED | 2026-08-02 | EVIDENCE §S0-3 |
| F-053 | Mainnet USDC SAC constant is `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` (package constant; **not** independently verified on pubnet — out of pre-build scope). | VERIFIED (source only) | 2026-08-02 | `mechanisms/stellar/src/constants.ts` L29 |
| F-054 | **Measured settlement fee on `stellar:testnet`: 23 073 stroops = 0.0023073 XLM**, observed repeatedly across the x402.org facilitator's settlements (a second cluster at 20 654 stroops = 0.0020654 XLM). The RFP's "about 0.0023 XLM" (§2) is confirmed to two significant figures by live measurement. Observed `max_fee` 33 253 — only ~1.5× headroom under the 50 000-stroop default ceiling (F-037). | VERIFIED | 2026-08-02 | EVIDENCE §S0-4 |
| F-055 | The x402.org Stellar facilitator settles using a **fee-bump transaction with a separate fee account** (`source_account` = GC6CSXBV…, `fee_account` = GC5OLUZ4…), i.e. it uses the package's `feeBumpSigner` path in production. | VERIFIED | 2026-08-02 | EVIDENCE §S0-4 |
| F-056 | e2e suite lives at `e2e/`, run with `pnpm install:all` then `pnpm test` (interactive selector) or `pnpm test --min`. Stellar env vars: `SERVER_STELLAR_ADDRESS`, `CLIENT_STELLAR_PRIVATE_KEY`, `FACILITATOR_STELLAR_PRIVATE_KEY`; facilitator process also reads `STELLAR_PRIVATE_KEY`, `STELLAR_NETWORK` (default `stellar:testnet`), `STELLAR_RPC_URL`. Requires Node ≥ 22. Setup path: Stellar Lab keypair + Friendbot → USDC trustline via lab.stellar.org/account/fund → **Circle faucet** (faucet.circle.com, select Stellar) for testnet USDC. | VERIFIED | 2026-08-02 | `e2e/README.md` L120-226; `e2e/package.json` |
| F-057 | Wire header names, from SDK source: request `X-PAYMENT`; payment response `X-PAYMENT-RESPONSE` (the offer-receipt extension also accepts bare `PAYMENT-RESPONSE` as a fallback); facilitator→server `EXTENSION-RESPONSES`. | VERIFIED | 2026-08-02 | `core/src/http/x402HTTPClient.ts` L98,151; `core/src/http/httpFacilitatorClient.ts` L262; `extensions/src/offer-receipt/client.ts` L178 |
| F-058 | Toolchain pinned: Node **v24.14.0** (local) — but `@x402/stellar` and the e2e suite both declare `engines.node >= 22`; pnpm **10.32.1**; npm 11.9.0; git 2.53.0. All `@x402/*` packages at **2.20.0**, Apache-2.0. | VERIFIED | 2026-08-02 | G0.1 capture; `npm view`; EVIDENCE §S0-1 |
| F-059 | `@x402/stellar@2.20.0` requires `@stellar/stellar-sdk: ^16.0.1` and `@x402/core: ~2.20.0`. Pinning `@stellar/stellar-sdk` at `^14` produces a **duplicate SDK in the tree** (14.6.1 + 16.2.0) and the settle path's fee arithmetic is written against v16 semantics. We must pin `^16`. | VERIFIED | 2026-08-02 | `node_modules/@x402/stellar/package.json`; EVIDENCE §S0-5; `scheme.ts` L253 comment |
| F-060 | **Q-010 license scan PASS.** 294 distinct packages across the full planned dependency set: 249 MIT, 17 Apache-2.0, 14 ISC, 8 BSD-3-Clause, 2 BSD-2-Clause, 3 permissive dual/multi, 1 Unlicense. **Zero AGPL/SSPL/OSL/EUPL/CPAL/RPL. Zero GPL/LGPL/MPL/CDDL/EPL. Zero undeclared.** | VERIFIED | 2026-08-02 | EVIDENCE §S0-5 |
| F-061 | Package version drift is fast and real: `@x402/*` moved **2.17.0 → 2.20.0 in the two days** between the 2026-07-31 fact-check and 2026-08-02. The pinned spec SHA is dated 2026-08-01, one day before this session. The RFP's "drift, not inability, is the failure mode" (§4) is empirically supported. | VERIFIED | 2026-08-02 | F-001 vs F-058 |

### Session 1 — from package source and the published artifact

| ID | Claim | Status | Date | Source |
|---|---|---|---|---|
| F-062 | `gatherAuthEntrySignatureStatus` classifies an auth entry as signed purely by testing that its signature `ScVal` is **not** `scvVoid` — it performs **no cryptographic verification**. A forged or corrupted signature is therefore invisible to every check `@x402/stellar` makes on its own, and is caught only by the Soroban host during simulation. This is why "simulation MUST succeed" (F-035) is load-bearing rather than defence-in-depth: it is the sole control against a forged authorization. | VERIFIED | 2026-08-02 | `mechanisms/stellar/src/shared.ts` L117-126 @ SHA; demonstrated EVIDENCE S1-4 |
| F-063 | The 37 reason codes of F-045 are present **in the published npm artifact** of `@x402/stellar@2.20.0` (`dist/esm/exact/facilitator/index.mjs`), not only in the source tree S0-6 read. The enumeration is asserted against the installed bundle by `packages/facilitator/test/errors.test.ts`, so an upstream rename breaks the build rather than degrading a rejection reason silently. | VERIFIED | 2026-08-02 | EVIDENCE S1-5 |
| F-064 | The verification step ordering in `ExactStellarScheme._verify` places auth-entry checks (expiry bound, credential type, sub-invocations, signature status) and transfer-event checks **after** `simulateTransaction`. Consequently, on a network where simulation cannot succeed, those codes are unreachable and every payload collapses to `invalid_exact_stellar_payload_simulation_failed`. Structural checks (version, scheme, network, operation shape, asset, function name, recipient, amount, facilitator safety) all precede simulation and remain reachable. | VERIFIED | 2026-08-02 | `scheme.ts` L385-551 @ SHA; EVIDENCE S1-3, S1-4 |

---

## Verification queue — status after Session 0

**Gate G-FACTS: implementation does not start while any P0 row is OPEN.**

| ID | Question | Status | Closed by |
|---|---|---|---|
| Q-001 | bazaar.md shapes, filters, search, MCP keying, soft-drop, routeTemplate | **CLOSED** | F-023 … F-032 |
| Q-002 | scheme_exact_stellar payload format + validation requirements | **CLOSED** | F-033 … F-039 |
| Q-003 | `/supported` response incl. `extra.areFeesSponsored` | **CLOSED** | F-040 … F-043 (spec + live) |
| Q-004 | e2e suite location, stellar:testnet invocation, env vars | **CLOSED (docs)** | F-056. Local run still blocked — see Q-011. |
| Q-005 | `@x402/stellar` facilitator surface; package vs wrapper validation split | **CLOSED** | F-044 … F-047 |
| Q-006 | facilitator-side cataloging helpers in `@x402/extensions` | **CLOSED — expectation was wrong** | F-048 … F-051 |
| Q-007 | Testnet USDC issuer + SAC contract ID, on-chain | **CLOSED** | F-052 (4 independent checks) |
| Q-008 | Actual settlement fee on testnet | **CLOSED** | F-054 (live measurement, 0.0023073 XLM) |
| Q-009 | Custom `__check_auth` account support (P1) | **PARTIAL** | Spec states auth-entry signing "supports both C-accounts and G-accounts" and mandates `sorobanCredentialsAddress` credentials. Contract-account signature semantics not yet traced. Deferred — P1, proposal-only. |
| Q-010 | Dependency license scan | **CLOSED — PASS** | F-060 |
| Q-011 | Live stock-client 402 → payment → settle transcript | **OPEN — BLOCKED** | See below. |
| Q-012 | Pin toolchain + `@x402/*` versions | **CLOSED** | F-058, F-059 |
| Q-013 | Wire header names/casing | **CLOSED** | F-057 (from SDK source, stronger than a transcript for casing) |

### Q-011 — the one row that did not close, and why

A full 402 → `X-PAYMENT` → settle transcript needs a buyer account holding **testnet USDC**. The only funding path documented by the x402 repo (F-056) is the **Circle faucet at faucet.circle.com**, which is interactive and captcha-gated — it cannot be driven from this session. Friendbot (XLM) and trustline creation are both automatable; the USDC leg is not.

Everything Q-011 was meant to establish that *could* be sourced elsewhere has been:
- `/supported` shape and live Stellar values → F-041, F-042, F-043 (live capture).
- Header names and casing → F-057 (SDK source).
- Real settlement fee → F-054 (measured from the public facilitator's own on-chain settlements).
- Settled-transaction anatomy → EVIDENCE §S0-4 decodes a real x402 settlement end to end.

What remains genuinely unproven is the **round-trip through a stock client**, which is the S2 acceptance case anyway. It is not a blocker for S1.

**To unblock:** fund one testnet account with USDC at faucet.circle.com (select Stellar), then Q-011 and the local e2e run (Q-004) both close. Nothing else is needed.

---

## Update log

| Date | Change | By |
|---|---|---|
| 2026-07-31 | Initial population from RFP fact-check (web-verified) + verification queue | Kunal / Claude session |
| 2026-08-02 | Materialized into repo. Pinned spec SHA `17fc9890…` written into header (G0.2). RFP captured verbatim to `docs/rfp.md` (G0.3). | Claude session S0 |
| 2026-08-02 | Session 0 verification: added F-023 … F-061 from pinned spec, package source, live capture, and on-chain measurement. Closed Q-001 … Q-008, Q-010, Q-012, Q-013. Q-011 blocked on captcha-gated USDC faucet; Q-009 partial (P1). | Claude session S0 |
| 2026-08-02 | Session 1 build: monorepo scaffold + `packages/facilitator`. Added F-062 … F-064 from package source and the published artifact. Added DECISIONS D-016 (do not advertise `bazaar` before it is reachable) and D-017 (test against a Soroban RPC double; label its results as modelled). Evidence S1-1 … S1-5. **Q-011 unchanged — still OPEN and still the only blocker on a live round-trip.** | Claude session S1 |
