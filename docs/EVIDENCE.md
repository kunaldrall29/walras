# EVIDENCE — walras pre-build

Captured transcripts, hashes, and command output. Every "works" claim in the SCF
submission must point at a section here. Nothing else counts.

Pinned spec commit: `x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`

---

## Accounts (stellar:testnet, created 2026-08-02)

Public keys only. Secrets live in the gitignored `.env`; regenerate with
`node scripts/setup-accounts.mjs`. Role names match the x402 e2e suite's env vars (F-056).

Payment asset: `USDC` SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`,
issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (verified in §S0-3).

| Role | Public key | Friendbot funding tx | USDC trustline tx |
|---|---|---|---|
| facilitator submitter | `GATIEPZCNFNIORFMN3YYTBEPJDELAFX4TDKBXLUIBFHDNGEXXBKICWWI` | `6add723922a54646a978f6542f9fc7a71a33a67cb79be1d11756fd9c58588e04` | n/a — sponsors fees, never holds USDC |
| seller payTo | `GD7JFO5L4WP7FGRFB33ATR5NJF2FWSC5FTOAKCAYWUMIBMNHFURKNI3R` | `d6d886133f57ce8f38f9836da4046be52b3bf4e7f161adeb2aa64e41eda54a17` | `9d8ceb9ab9235bb77c94866351fbda3df9394b38649fef266eba765f5d34734a` |
| buyer agent | `GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK` | `34dbb2aaba034e51c7b576c286c48245089220b4226ce294a283ed476cc2ff95` | `e018072160ab5e40aa0a4df1e5bfbb6d1390b4b132b8adabdd701aa7c9c29529` |

On-chain state confirmed via Horizon immediately after setup:

```
GATIEPZC…  XLM 10000.0000000                                    (no trustline — correct)
GD7JFO5L…  USDC 0.0000000 issuer=GBBD47IF6LWK…   XLM 9999.9999900
GACCDSSZ…  USDC 0.0000000 issuer=GBBD47IF6LWK…   XLM 9999.9999900
```

The two USDC lines confirm the trustlines exist and are ready to receive; a zero balance with a
present trustline is the correct pre-funding state.

> **Open action — the only manual step in the whole pre-build.**
> Fund the **buyer agent** `GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK`
> with testnet USDC at faucet.circle.com (select Stellar). That single step closes Q-011
> and unblocks the local e2e run (Q-004).

This setup also demonstrates the onboarding nuance worth naming in the submission: the RFP's
"buyer needs only the payment asset and no XLM" (3.1) is true of the *payment flow* — fees are
sponsored — but account *creation* still consumed a base reserve, and the trustline consumed
another (visible above as the 0.0000100 XLM fee delta). That gap is precisely what the RFP's
referenced AHA Labs Trustline Onboarder addresses.

---

## S0-1 — Pre-flight gates (2026-08-02)

### G0.1 toolchain

```
$ node --version
v24.14.0
$ pnpm --version
10.32.1
$ npm --version
11.9.0
$ git --version
git version 2.53.0
```

Note: `@x402/stellar@2.20.0` and the x402 e2e suite both declare `engines.node >= 22`;
v24.14.0 satisfies this. → FACTS F-058.

### G0.2 spec pin

```
$ git clone https://github.com/x402-foundation/x402 /workspaces/x402
$ git -C /workspaces/x402 rev-parse HEAD
17fc9890ade45a570a019352a3573391ad5d1e1f
$ git -C /workspaces/x402 log -1 --format=%cI
2026-08-01T14:16:23+02:00
```

The pinned commit is dated one day before this session. → FACTS F-061.

### G0.3 required documents

Initially **FAILED** — `/workspaces/walras/docs/` did not exist; the repo carried only
`LICENSE` (Apache-2.0) and `README.md` at commit `3d7dde1`. Resolved by capturing the RFP
verbatim to `docs/rfp.md` and materializing `docs/FACTS.md`, then re-running:

```
PASS  docs/FACTS.md (78 lines, 9131 bytes)
PASS  docs/rfp.md (282 lines, 21531 bytes)
Pinned spec commit: `x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f`
```

### STOP-condition check — spec files present at pinned SHA

```
specs/extensions/bazaar.md                      present  (590 lines)
specs/schemes/exact/scheme_exact_stellar.md     present  (229 lines)
specs/x402-specification-v2.md                  present
e2e/                                            present  (incl. e2e/servers/next/app/api/exact/stellar)
typescript/packages/mechanisms/stellar          present
```

No STOP condition triggered.

---

## S0-2 — Live capture: x402.org facilitator `/supported` (2026-08-02)

```
$ curl -s https://x402.org/facilitator/supported
HTTP 200
```

Stellar-relevant excerpt of the response body, verbatim:

```json
{"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}
```

```json
"extensions":["builder-code","eip2612GasSponsoring","erc20ApprovalGasSponsoring"]
```

```json
"signers":{
  "stellar:*":[
    "GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K",
    "GC5OLUZ4WANPN6VT7YGTK2SRMZG762KOVKJXHWIO4K57UBASO2FMNRET"
  ]
}
```

Also observed, for cross-chain context:

```json
{"x402Version":2,"scheme":"exact","network":"xrpl:1","extra":{"areFeesSponsored":false}}
{"x402Version":2,"scheme":"upto","network":"eip155:84532","extra":{"facilitatorAddress":"0xd407e409E34E0b9afb99EcCeb609bDbcD5e7f1bf"}}
```

**Findings.** `extra.areFeesSponsored: true` confirmed live for `stellar:testnet` (F-041).
Two Stellar signers advertised, consistent with the package's round-robin selector.
**`bazaar` is absent from the advertised extensions** (F-042) and **no `stellar:pubnet` kind is
advertised** — the RFP's "advertised vs reachable support" caution, evidenced. `areFeesSponsored`
also appears with a `false` value on XRPL, confirming it is a general field (F-043).

---

## S0-3 — On-chain verification: testnet USDC SAC (Q-007, 2026-08-02)

Probe: `scratchpad/probe/usdc-verify.mjs`, run against `https://soroban-testnet.stellar.org`.
Four independent checks, none of which trusts documentation.

```
== Q-007 on-chain verification ==
RPC          : https://soroban-testnet.stellar.org
claimed USDC : CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
rpc health   : healthy latestLedger 3928235
executable   : contractExecutableStellarAsset
RESULT A     : PASS - contract IS a Stellar Asset Contract (SAC)
  storage    : "METADATA" => {"decimal":7,"name":"USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5","symbol":"USDC"}
  storage    : ["Admin"] => "CCELIKMY7RQ3BQERWSOQHLIVYC5E3UHLTLDYIO2NVS5XGFEXYER5UWSB"
  storage    : ["AssetInfo"] => ["AlphaNum4",{"asset_code":"USDC","issuer":{...}}]
name()       : USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
symbol()     : USDC
decimals()   : 7
asset code   : USDC
asset issuer : GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
derived SAC  : CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
RESULT B     : PASS - derived contract ID matches claimed ID
decimals == 7: PASS
```

The four converging checks:

1. Spec example — `specs/schemes/exact/scheme_exact_stellar.md` L51 uses this contract ID.
2. Package constant — `USDC_TESTNET_ADDRESS` in `mechanisms/stellar/src/constants.ts` L30.
3. On-chain instance — the ledger entry exists and its executable is
   `contractExecutableStellarAsset`, i.e. a genuine SAC, with `decimals = 7`.
4. Cryptographic re-derivation — `Asset("USDC", "GBBD47IF…").contractId(Networks.TESTNET)`
   round-trips to the identical contract ID, which independently proves the issuer binding.

→ FACTS F-052.

---

## S0-4 — Measured settlement fee and settlement anatomy (Q-008, 2026-08-02)

Rather than fund our own accounts, we measured the **public facilitator's own settled
transactions** on testnet via Horizon.

```
$ curl -s "https://horizon-testnet.stellar.org/accounts/GC6CSXBV.../transactions?order=desc&limit=25"

4ffb246362878b8a fee_charged=23073 max_fee=33253 ops=1 succ=true 2026-07-29T03:53:40Z
6ae3f6af715eb516 fee_charged=23073 max_fee=33253 ops=1 succ=true 2026-07-28T12:53:24Z
001632683094c5fc fee_charged=23073 max_fee=33253 ops=1 succ=true 2026-07-28T12:50:39Z
32d6717997094392 fee_charged=20654 max_fee=30791 ops=1 succ=true 2026-07-28T01:42:40Z
a20ebd6da177942f fee_charged=20654 max_fee=30791 ops=1 succ=true 2026-07-28T01:41:00Z
5b0a03a47e177f8a fee_charged=20654 max_fee=30791 ops=1 succ=true 2026-07-28T01:35:14Z
31cd7cdb8c76b425 fee_charged=23073 max_fee=33253 ops=1 succ=true 2026-07-26T19:54:44Z
… (25 records, all successful, all 1 operation)
```

**Measured fee: 23 073 stroops = 0.0023073 XLM** (dominant cluster), with a second cluster at
20 654 stroops = 0.0020654 XLM. The RFP's "about 0.0023 XLM" (§2) is confirmed to two significant
figures by live measurement. → FACTS F-054.

### Anatomy of one settlement

```
hash        : 4ffb246362878b8ad0d4a5348ac6f87d0eee3d20957982d6224934325f8efa60
source      : GC6CSXBV4C6RL3HEDTW57KXYXSSXKAWKGYDEOSATXM3XNKXSR2VRYN3K
fee_account : GC5OLUZ4WANPN6VT7YGTK2SRMZG762KOVKJXHWIO4K57UBASO2FMNRET
fee_charged : 23073 stroops = 0.0023073 XLM
max_fee     : 33253
op_count    : 1
```

```
type      : invoke_host_function
function  : HostFunctionTypeHostFunctionTypeInvokeContract
params    : [Address, Sym("transfer"), Address, Address, I128]
asset_bal : [{ asset_code: "USDC",
               asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
               type: "transfer",
               from: "GDENLOVXZTJXN7B62BPJBCCKGZ37JC6TFJWZTDYBIH3HVWA3RZ73UR4Z",
               to:   "GDWT3YRVK73LUUBIGHEY7BKNO3HHLOARAQLJTP62NSLAJWMXPSKNVTVU",
               amount: "0.0100000" }]
```

XDR decode of the invocation parameters:

```
contract param[0] = CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
expected USDC SAC = CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
amount i128       = 100000 base units
```

**Findings.**
- The settled contract is exactly the USDC SAC verified in S0-3 — closing the loop between
  the asset verification and a real settlement.
- `100000` base units at 7 decimals = `0.0100000` USDC, confirming integer base-unit handling (F-008).
- Neither `from` nor `to` is a facilitator signer — the non-custodial property, observed.
- **`source_account` ≠ `fee_account`**: the reference operator settles via a **fee-bump transaction
  with a dedicated fee account**, i.e. it runs the package's `feeBumpSigner` path in production.
  → FACTS F-055, DECISIONS D-012.
- Observed `max_fee` 33 253 sits only ~1.5× below the package's 50 000-stroop default ceiling
  (F-037) — worth surfacing as an operator knob rather than leaving at default silently.

---

## S0-5 — Dependency license scan (Q-010, 2026-08-02)

Scan of the full planned dependency set (`@x402/{core,stellar,extensions,express,fetch,mcp}@2.20.0`,
`@stellar/stellar-sdk`, `better-sqlite3`, `express`, `fastify`, `zod`, `typescript`, `vitest`),
walking every `package.json` under `node_modules`. Script: `scratchpad/probe/lic/scan.mjs`.

```
=== Q-010 dependency license scan ===
total distinct packages: 294

--- license histogram ---
 249 MIT
  17 Apache-2.0
  14 ISC
   8 BSD-3-Clause
   2 BSD-2-Clause
   1 (MIT OR WTFPL)
   1 (BSD-2-Clause OR MIT OR Apache-2.0)
   1 (MIT AND BSD-3-Clause)
   1 Unlicense

--- FORBIDDEN (AGPL/SSPL/OSL/EUPL/CPAL/RPL) ---
  none

--- REVIEW (GPL/LGPL/MPL/CDDL/EPL family) ---
  none

--- UNKNOWN / undeclared ---
  none

--- direct @x402/* and stellar ---
  @stellar/js-xdr@3.1.2          Apache-2.0
  @stellar/js-xdr@4.0.0          Apache-2.0
  @stellar/stellar-base@14.1.0   Apache-2.0
  @stellar/stellar-sdk@14.6.1    Apache-2.0
  @stellar/stellar-sdk@16.2.0    Apache-2.0
  @x402/core@2.20.0              Apache-2.0
  @x402/express@2.20.0           Apache-2.0
  @x402/extensions@2.20.0        Apache-2.0
  @x402/fetch@2.20.0             Apache-2.0
  @x402/mcp@2.20.0               Apache-2.0
  @x402/stellar@2.20.0           Apache-2.0

GATE G-LIC: PASS — no strong copyleft in tree
EXIT=0
```

**Gate G-LIC: PASS.** Zero AGPL/SSPL anywhere in the tree, zero weak-copyleft, zero undeclared
licenses across 294 packages. → FACTS F-060.

**Incidental finding.** The scan surfaced **two** `@stellar/stellar-sdk` versions (14.6.1 from our
probe pin, 16.2.0 pulled by `@x402/stellar`). `@x402/stellar@2.20.0` requires `^16.0.1` and its
settle path is written against v16 fee semantics. The probe's `^14` pin was wrong; production
manifests must pin `^16`. → FACTS F-059, DECISIONS D-013.

---

## S0-6 — Reason-code enumeration from package source (2026-08-02)

Enumerated directly from `mechanisms/stellar/src/exact/facilitator/scheme.ts` @ pinned SHA, to
substantiate the "non-null `reason` on every rejection" claim (RFP 3.6) with a counted inventory
rather than an assertion.

```
$ grep -oE '"(invalid|unsupported|unexpected|network|settle|verification)[a-z0-9_]*"' scheme.ts \
    | tr -d '"' | sort -u

TOTAL DISTINCT = 37
verify-path    = 30
settle-path    =  7
```

Full list: `invalid_exact_stellar_payload_{event_missing_contract_id, event_not_transfer,
event_wrong_amount, event_wrong_asset, event_wrong_from, event_wrong_to, facilitator_in_auth,
facilitator_is_payer, fee_exceeds_maximum, has_subinvocations, malformed, missing_payer_signature,
multiple_transfers, no_auth_entries, no_transfer_events, simulation_failed,
unexpected_pending_signatures, unsafe_tx_or_op_source, unsupported_credential_type, wrong_amount,
wrong_asset, wrong_function_name, wrong_operation, wrong_recipient}`,
`invalid_exact_stellar_signature_expiration_too_far`, `invalid_network`, `invalid_x402_version`,
`network_mismatch`, `unexpected_verify_error`, `unsupported_scheme`;
`settle_exact_stellar_{fee_bump_signing_failed, signer_selection_failed, transaction_failed,
transaction_signing_failed, transaction_submission_failed}`, `unexpected_settle_error`,
`verification_failed`.

Methodological note, recorded because it nearly became a false FACTS row: a first pass using the
character class `[a-z_]` returned 35 and silently dropped two codes — `invalid_x402_version`
(contains digits) and `verification_failed` (reached via `verifyResult.invalidReason ?? "…"`
rather than a literal assignment). The corrected pattern above is the one to reuse when
re-verifying against a future SHA. → FACTS F-045, DECISIONS D-007.

---

## S1-1 — Session 1 pre-flight gates (2026-08-02)

### G1.1 — FACTS gate (G-FACTS)

Implementation may not start while any P0 row is OPEN. Read from the verification queue
above at the start of the session:

```
Q-001 bazaar.md shapes/filters/search/MCP keying    CLOSED
Q-002 scheme_exact_stellar payload + validation     CLOSED
Q-003 /supported incl. extra.areFeesSponsored       CLOSED
Q-004 e2e suite location, env vars                  CLOSED (docs)
Q-005 @x402/stellar facilitator surface             CLOSED
Q-006 facilitator-side cataloging helpers           CLOSED
Q-012 pinned toolchain + @x402/* versions           CLOSED
```

**GATE G1.1: PASS.** No STOP condition. Q-011 remains OPEN and Q-009 PARTIAL; neither is
in the G1.1 set, and neither blocks S1 — see the Q-011 note above.

### G1.2 — install at pinned versions, single SDK, license scan

```
$ pnpm install
Packages: +148
Done in 5.1s using pnpm v10.32.1

$ node -e "..."   # resolved versions in packages/facilitator
@x402/core               2.20.0       Apache-2.0
@x402/stellar            2.20.0       Apache-2.0
@stellar/stellar-sdk     16.2.0       Apache-2.0
fastify                  5.11.0       MIT
vitest                   3.2.7        MIT
typescript               5.9.3        Apache-2.0
tsx                      4.23.1       MIT
```

Every version matches the Q-012 pins (F-058, F-059). `@stellar/stellar-sdk` resolves to
`^16` as D-013 requires, and the duplicate-SDK assertion D-013 asked for now runs as part
of `pnpm test`:

```
$ node scripts/check-single-stellar-sdk.mjs
check:deps PASS — exactly one @stellar/stellar-sdk in the tree (16.2.0)
```

License scan, re-run against the real repository tree rather than a probe directory
(`scripts/license-scan.mjs`, the in-repo successor to the Session 0 script):

```
$ node scripts/license-scan.mjs
=== G-LIC dependency license scan ===
total distinct packages: 148

--- license histogram ---
 130 MIT
   7 BSD-3-Clause
   6 Apache-2.0
   5 ISC

--- FORBIDDEN (AGPL/SSPL/OSL/EUPL/CPAL/RPL) ---
  none

--- REVIEW (GPL/LGPL/MPL/CDDL/EPL family) ---
  none

--- UNKNOWN / undeclared ---
  none

--- direct @x402/* and @stellar/* ---
  @stellar/js-xdr@4.0.0            Apache-2.0
  @stellar/stellar-sdk@16.2.0      Apache-2.0
  @x402/core@2.20.0                Apache-2.0
  @x402/stellar@2.20.0             Apache-2.0

GATE G-LIC: PASS — no copyleft or undeclared licenses in tree
```

**GATE G1.2: PASS.** The tree is 148 packages against Session 0's 294 because the build set
is narrower than the planned set S0-5 scanned — no `@x402/{express,fetch,mcp}`,
no `better-sqlite3`, no `express`. Nothing was removed to make the gate pass; those
packages simply are not dependencies of the facilitator.

### G1.3 — submitter funded, RPC reachable

```
$ node scripts/preflight.mjs
== G1.3 preflight ==
network   : stellar:testnet
rpc       : https://soroban-testnet.stellar.org
horizon   : https://horizon-testnet.stellar.org

PASS  submitter secret parses      GATIEPZCNFNIORFMN3YYTBEPJDELAFX4TDKBXLUIBFHDNGEXXBKICWWI
PASS  rpc reachable                status=healthy latestLedger=3935211
PASS  submitter account exists     sequence=16872809087107072
PASS  submitter funded             10000.0000000 XLM (minimum 1)
INFO  submitter trustlines         none — correct for a fee sponsor

GATE G1.3: PASS
```

The submitter is the account created in Session 0 (see Accounts, above). It holds XLM and
no trustline, which is the correct state for an account that sponsors fees and never
touches the payment asset (F-006).

`scripts/setup-accounts.mjs` was **not** re-run: it generates fresh keypairs on every
invocation, so re-running it would have replaced the accounts this evidence file records
rather than confirming them. The check above verifies the recorded account on-chain
instead, which is the property the gate is actually asking about.

---

## S1-2 — Test suite (2026-08-02)

```
$ pnpm test

> walras@0.1.0 test
> pnpm run check:deps && pnpm -r test

check:deps PASS — exactly one @stellar/stellar-sdk in the tree (16.2.0)

 RUN  v3.2.7 /workspaces/walras/packages/facilitator

 ✓ test/settle.test.ts   (16 tests) 3225ms
 ✓ test/verify.test.ts   (26 tests) 2259ms
 ✓ test/supported.test.ts (9 tests)  191ms
 ✓ test/config.test.ts   (16 tests)   61ms
 ✓ test/errors.test.ts    (9 tests)   16ms

 Test Files  5 passed (5)
      Tests  76 passed (76)
   Duration  8.61s
```

Every negative case asserts **both** that the payment was rejected **and** the specific
reason code. Fixture-driven verify cases, each mapped to the code it must produce:

| Fixture | Reason code |
|---|---|
| `wrongAmount` | `invalid_exact_stellar_payload_wrong_amount` |
| `wrongAsset` | `invalid_exact_stellar_payload_wrong_asset` |
| `wrongRecipient` | `invalid_exact_stellar_payload_wrong_recipient` |
| `facilitatorIsPayer` | `invalid_exact_stellar_payload_facilitator_is_payer` |
| `facilitatorIsTxSource` | `invalid_exact_stellar_payload_unsafe_tx_or_op_source` |
| `wrongOperation` | `invalid_exact_stellar_payload_wrong_operation` |
| `malformedTransaction` | `invalid_exact_stellar_payload_malformed` |
| `expirationTooFar` | `invalid_exact_stellar_signature_expiration_too_far` |
| `unsignedAuthEntry` | `invalid_exact_stellar_payload_missing_payer_signature` |
| `hasSubInvocations` | `invalid_exact_stellar_payload_has_subinvocations` |
| `noAuthEntries` | `invalid_exact_stellar_payload_no_auth_entries` |
| `tamperedAuthSignature` | `invalid_exact_stellar_payload_simulation_failed` |

**Provenance of the fixtures.** Session 0 could not capture a real signed payload — a stock
client cannot build one without a USDC-funded buyer, which is Q-011. These transactions are
therefore **synthesized, not captured**: real keys, real Ed25519 signatures over the real
CAP-46 authorization preimage, real XDR, assembled locally by
`scripts/build-fixtures.mjs` from what Session 0 *did* establish — the accounts above, the
USDC SAC of S0-3, the payload shape of F-033, the expiry rule of F-034. None has been
submitted to a network.

Two fixtures are worth naming individually. `facilitatorIsPayer` and `facilitatorIsTxSource`
are separate MUST NOTs in spec section 4 and the package checks them at different points;
they are asserted separately so one cannot mask the other, and a third test confirms both
are refused **before any simulation is attempted** — the fee sponsor is protected without
the transaction ever touching RPC.

---

## S1-3 — Live transcripts, `stellar:testnet` (2026-08-02)

Facilitator built from this repository, configured against the real Soroban RPC and the
Session 0 submitter. Captured with `scripts/capture-transcripts.sh`. Responses verbatim,
headers included.

```
$ curl -s -i -X GET http://localhost:4021/supported
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 209

{"kinds":[{"x402Version":2,"scheme":"exact","network":"stellar:testnet","extra":{"areFeesSponsored":true}}],"extensions":[],"signers":{"stellar:*":["GATIEPZCNFNIORFMN3YYTBEPJDELAFX4TDKBXLUIBFHDNGEXXBKICWWI"]}}
```

The Stellar kind is byte-identical to what `x402.org/facilitator/supported` advertises
(S0-2, F-041), including `extra.areFeesSponsored: true`. `extensions` is empty by decision,
not omission — D-016.

```
$ curl -s -i -X GET http://localhost:4021/health
HTTP/1.1 200 OK

{"status":"ok","x402Version":2,"network":"stellar:testnet","rpcUrl":"https://soroban-testnet.stellar.org","submitters":["GATIEPZCNFNIORFMN3YYTBEPJDELAFX4TDKBXLUIBFHDNGEXXBKICWWI"],"feeBumpAddress":null,"port":4021,"feeMode":"free","dbPath":"./data/catalog.db","maxTransactionFeeStroops":50000}
```

### A payment rejected for a reason attributable entirely to the payload

```
$ curl -s -i -X POST http://localhost:4021/verify -H 'Content-Type: application/json' -d @verify-wrongAmount.json
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 235

{"isValid":false,"invalidReason":"invalid_exact_stellar_payload_wrong_amount","payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK","invalidMessage":"The transfer amount does not equal paymentRequirements.amount exactly."}
```

```
$ curl -s -i -X POST http://localhost:4021/settle -H 'Content-Type: application/json' -d @settle-wrongAmount.json
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 276

{"success":false,"network":"stellar:testnet","transaction":"","errorReason":"invalid_exact_stellar_payload_wrong_amount","payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK","errorMessage":"The transfer amount does not equal paymentRequirements.amount exactly."}
```

This pair is the load-bearing one. The amount check runs **before** simulation, so the
rejection is attributable to the payload alone and nothing about the buyer's balance is
involved. `/settle` reaches the same verdict having been given no prior `/verify` — F-036
in action, live.

### A well-formed payload, and the honest limit of what live testnet can show

```
$ curl -s -i -X POST http://localhost:4021/verify -H 'Content-Type: application/json' -d @verify-valid.json
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 248

{"isValid":false,"invalidReason":"invalid_exact_stellar_payload_simulation_failed","payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK","invalidMessage":"Re-simulation of the transaction against current ledger state did not succeed."}
```

**Read this carefully rather than as a failure.** The payload passed every structural check
— version, scheme, network, single `invokeHostFunction`, contract equals `asset`, function
`transfer` with three arguments, recipient equals `payTo`, amount exact, facilitator absent
from source and payer — and was rejected at the *next* step, simulation. It reached
simulation, and simulation failed because the buyer `GACCDSSZ…` holds **0 USDC**: the
transfer would panic. That is Q-011, unchanged.

The consequence is a real limit and it should be stated rather than glossed: **against live
testnet, a valid payload and a tampered one are indistinguishable** — both return
`invalid_exact_stellar_payload_simulation_failed`. A transcript that showed only this could
not honestly claim the tampered case was caught *because it was tampered*. S1-4 addresses
that; a USDC-funded buyer would remove the need for it.

### Wrapper-level rejections

```
$ curl -s -i -X POST http://localhost:4021/verify -H 'Content-Type: application/json' -d '{not json'
HTTP/1.1 400 Bad Request
content-type: application/json; charset=utf-8
content-length: 159

{"isValid":false,"invalidReason":"walras_malformed_request_body","invalidMessage":"The request body was absent, was not valid JSON, or was not a JSON object."}
```

```
$ curl -s -i -X GET http://localhost:4021/discovery/resources
HTTP/1.1 404 Not Found
content-type: application/json; charset=utf-8
content-length: 182

{"error":{"code":"walras_unknown_route","reason":"No route is mounted at this method and path. This facilitator serves POST /verify, POST /settle, GET /supported, and GET /health."}}
```

Note the shape of the 400: it is a `VerifyResponse`, not a bare `{error: …}`. The stock
`HttpFacilitatorClient` parses non-2xx bodies and raises a `VerifyError` carrying
`invalidReason` when it finds `isValid` — any other shape would drop the machine-readable
code at that boundary.

---

## S1-4 — Modelled transcripts via the Soroban RPC double (2026-08-02)

**These results are modelled, not observed on-chain.** The facilitator here runs against an
in-process JSON-RPC double, not testnet; no transaction below exists on any ledger. Read
S0-4 for what a real settlement looks like. Rationale and limits: DECISIONS D-017,
ARCHITECTURE §4.1.

The double verifies auth-entry signatures for real — Ed25519 over the CAP-46 authorization
preimage, the same bytes `authorizeEntry` signs — and synthesizes the SEP-41 transfer event
from the invocation actually present in the transaction. It models no balances, no
footprints, and no nonce consumption.

```
$ curl -s -i -X POST http://localhost:4031/verify -H 'Content-Type: application/json' -d @verify-valid.json
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 83

{"isValid":true,"payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK"}
```

```
$ curl -s -i -X POST http://localhost:4031/settle -H 'Content-Type: application/json' -d @settle-valid.json
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 192

{"success":true,"transaction":"b8547f87bc3b1fd40d1b586efb84fcc4e11f40d698897ebbf89dc2741723f2ee","network":"stellar:testnet","payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK"}
```

The response satisfies F-038: a 64-character hex hash, and `payer` is the client
`GACCDSSZ…`, never the submitter. The hash is the genuine hash of the envelope the
facilitator built and signed — it is simply the hash of a transaction that was never
broadcast.

### The tampered payload, now discriminated

```
$ curl -s -i -X POST http://localhost:4031/verify -H 'Content-Type: application/json' -d @verify-tamperedAuthSignature.json
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 248

{"isValid":false,"invalidReason":"invalid_exact_stellar_payload_simulation_failed","payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK","invalidMessage":"Re-simulation of the transaction against current ledger state did not succeed."}
```

Same environment, same requirements, one bit of the payer's signature flipped — accepted
above, rejected here. The facilitator process log carries the underlying cause:

```
Simulation error: : HostError: Error(Auth, InvalidAction): signature verification failed for GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK
```

**A finding worth recording.** The tampered entry is structurally perfect and passes every
check `@x402/stellar` performs on its own: `gatherAuthEntrySignatureStatus` asks whether a
signature is *present*, not whether it *verifies* (`shared.ts` L120, pinned SHA). Catching
a forged signature is the Soroban host's job during simulation — which is exactly why
"simulation MUST succeed" is itself a spec MUST (F-035). The mandatory-simulation rule is
not belt-and-braces; it is the only thing standing between a facilitator and a forged
authorization.

```
$ curl -s -i -X POST http://localhost:4031/settle -H 'Content-Type: application/json' -d @settle-tamperedAuthSignature.json
HTTP/1.1 200 OK

{"success":false,"network":"stellar:testnet","transaction":"","errorReason":"invalid_exact_stellar_payload_simulation_failed","payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK","errorMessage":"Re-simulation of the transaction against current ledger state did not succeed."}
```

### The expiry bound

```
$ curl -s -i -X POST http://localhost:4031/verify -H 'Content-Type: application/json' -d @verify-expirationTooFar.json
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 276

{"isValid":false,"invalidReason":"invalid_exact_stellar_signature_expiration_too_far","payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK","invalidMessage":"An authorization entry expires beyond currentLedger + ceil(maxTimeoutSeconds / estimatedLedgerSeconds)."}
```

An auth entry expiring 5 000 ledgers out, against `maxTimeoutSeconds: 60`. Note this
rejection sits **after** simulation in the package's ordering, which is why it is
unreachable without the double while Q-011 is open.

The submitter address differs from S1-3 (`GAV5SY2V…` rather than `GATIEPZC…`) because the
fixtures are built against a disposable account derived from a fixed phrase — the
facilitator-safety cases need the facilitator's own address inside a transaction, and using
the real submitter would make the test suite depend on a gitignored secret.

---

## S1-5 — Reason-code drift check (2026-08-02)

D-007 commits walras to inheriting the package's 37 codes verbatim rather than inventing a
parallel taxonomy. That commitment is only worth anything if it is checked, so
`test/errors.test.ts` greps the **installed** bundle and fails on any difference:

```
$ grep -oE '"(invalid|unsupported|unexpected|network|settle|verification)[a-z0-9_]*"' \
    node_modules/@x402/stellar/dist/esm/exact/facilitator/index.mjs | sort -u | wc -l
37
```

The 37 codes recovered from the shipped bundle match the enumeration in
`packages/facilitator/src/errors.ts` exactly — which also independently re-confirms F-045
against the published artifact rather than against the source tree S0-6 read.

Since `@x402/*` moved 2.17.0 → 2.20.0 in two days (F-061), an upgrade that adds or renames
a code now breaks the build instead of silently degrading a rejection reason to
`undefined`.

**RFP 3.6 coverage.** A second test asserts every one of the 44 codes walras can emit —
37 inherited plus 7 `walras_*` — has non-empty human-readable text, and a third asserts the
two taxonomies are disjoint. `@x402/stellar` populates `invalidMessage` on exactly one of
its paths, so walras backfills the rest without ever altering the machine-readable code.
That is what makes "non-null reason on every rejection" true by construction rather than by
assertion.

---

## S2-1 — Session 2 pre-flight gates (2026-08-02)

### G2.1 — facilitator boots clean

`pnpm install --frozen-lockfile` (no changes), `pnpm build` clean, `pnpm test`:

```
 Test Files  5 passed (5)
      Tests  76 passed (76)
```

Boot from the built `dist`, verbatim:

```
{"level":30,...,"msg":"Server listening at http://127.0.0.1:4021"}
{"level":30,...,"network":"stellar:testnet","rpcUrl":"https://soroban-testnet.stellar.org",
 "submitters":["GATIEPZCNFNIORFMN3YYTBEPJDELAFX4TDKBXLUIBFHDNGEXXBKICWWI"],
 "feeBumpAddress":null,"port":4021,"feeMode":"free","dbPath":"./data/catalog.db",
 "maxTransactionFeeStroops":50000,"msg":"walras facilitator ready"}
```

`GET /supported` (live): one kind `{x402Version:2, scheme:"exact", network:"stellar:testnet",
extra:{areFeesSponsored:true}}`, `extensions: []` (D-016), one signer under `stellar:*`.

### G2.2 — accounts funded (the Q-011 blocker cleared)

Horizon, pre-payment:

| Account | XLM | USDC |
|---|---|---|
| buyer `GACCDS…H4WK` | 9999.99999 | **20.0000000** (Circle faucet, received 2026-08-02T09:23:00Z) |
| seller `GD7JFO…NI3R` | 9999.99999 | 0 (trustline present) |
| facilitator `GATIEP…CWWI` | 10000 | — (no trustline, by design — F-006) |

USDC is the SAC verified four ways in S0-3 (Q-007, F-052).

---

## S2-2 — The stock-client round-trip (Q-011 CLOSED, 2026-08-02)

### Topology

Two transparent HTTP taps ([demo/tap.mjs](../demo/tap.mjs)) sit *between* the components and
log every exchange verbatim (casing preserved via `rawHeaders`). Neither the buyer, the
seller, nor the facilitator is modified or aware of them:

```
buyer (@x402/fetch, stock) ──► :4030 tap ──► :4022 seller (@x402/express, stock)
                                             seller ──► :4031 tap ──► :4021 walras facilitator
```

- Seller: [demo/seller.ts](../demo/seller.ts) — stock `paymentMiddleware` + `x402ResourceServer`
  + `HTTPFacilitatorClient` + server-side `ExactStellarScheme`; one route `GET /weather`,
  `price: "$0.01"` (chosen so the settled transfer is 100000 base units — identical to the
  baseline settlement decoded in S0-4).
- Buyer: [demo/buyer.ts](../demo/buyer.ts) — stock `wrapFetchWithPayment` +
  `x402Client().register("stellar:*", new ExactStellarScheme(createEd25519Signer(...)))`.
  Line-for-line the Stellar subset of `e2e/clients/fetch/index.ts` @ pinned SHA.
  **Zero custom protocol code.**

### Buyer ↔ seller transcript (tap at :4030)

**Exchange 1 — unpaid request → 402.**

```
GET /weather
> host: 127.0.0.1:4030
> accept: */*
> user-agent: node

HTTP 402
< Content-Type: application/json; charset=utf-8
< PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Miwi… (528 b64 chars)
< Content-Length: 2
body: {}
```

`PAYMENT-REQUIRED`, base64-decoded:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "http://127.0.0.1:4030/weather", "description": "", "mimeType": "" },
  "accepts": [{
    "scheme": "exact",
    "network": "stellar:testnet",
    "amount": "100000",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "payTo": "GD7JFO5L4WP7FGRFB33ATR5NJF2FWSC5FTOAKCAYWUMIBMNHFURKNI3R",
    "maxTimeoutSeconds": 300,
    "extra": { "areFeesSponsored": true }
  }]
}
```

(Note `maxTimeoutSeconds: 300` — the `@x402/express` middleware default, not the scheme
spec's example value of 60 from F-034. The client derives the auth-entry expiry from it.)

**Exchange 2 — paid retry → 200.**

```
GET /weather
> host: 127.0.0.1:4030
> PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6MiwicGF5bG9hZCI6… (2332 b64 chars)
> Access-Control-Expose-Headers: PAYMENT-RESPONSE,X-PAYMENT-RESPONSE
> accept: */*
> user-agent: node

HTTP 200
< Content-Type: application/json; charset=utf-8
< PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLCJwYXllciI6… (256 b64 chars)
body: {"report":"sunny","temperatureC":31}
```

`PAYMENT-SIGNATURE`, decoded (transaction XDR elided):

```json
{
  "x402Version": 2,
  "payload": { "transaction": "AAAAAgAAAAAAAAAA… (1352 b64 chars, single invokeHostFunction)" },
  "resource": { "url": "http://127.0.0.1:4030/weather", "description": "", "mimeType": "" },
  "accepted": { …identical to the accepts[0] above… }
}
```

`PAYMENT-RESPONSE`, decoded:

```json
{
  "success": true,
  "payer": "GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK",
  "transaction": "ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155",
  "network": "stellar:testnet"
}
```

### Seller ↔ facilitator transcript (tap at :4031)

| # | at (UTC) | Exchange | Result |
|---|---|---|---|
| 1 | 19:07:24 | `GET /supported` (resource-server startup validation) | 200, the S2-1 body |
| 2 | 19:07:44 | `POST /verify` — body `{x402Version:2, paymentPayload, paymentRequirements}` (2062 chars, spec §7.1 shape) | 200 `{"isValid":true,"payer":"GACCDS…H4WK"}` |
| 3 | 19:07:46 | `POST /settle` — same body | 200 (at 19:07:54) `{"success":true,"transaction":"ac50c091…cc155","network":"stellar:testnet","payer":"GACCDS…H4WK"}` |

Settle wall-time ≈ 7 s: fresh verification + simulation + submission + confirmation (F-036).

### Stock buyer stdout, verbatim

```json
{
  "status": 200,
  "body": { "report": "sunny", "temperatureC": 31 },
  "paymentResponse": {
    "success": true,
    "payer": "GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK",
    "transaction": "ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155",
    "network": "stellar:testnet"
  }
}
```

**Finding — wire header names.** The v2 exchange uses `PAYMENT-REQUIRED` /
`PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, not F-057's `X-PAYMENT` / `X-PAYMENT-RESPONSE`.
The pinned spec (`specs/transports-v2/http.md` §Header Reference) names the `PAYMENT-*`
triple as canonical for v2, and `x402HTTPClient.encodePaymentSignatureHeader` switches on
`x402Version`: case 2 → `PAYMENT-SIGNATURE`, case 1 → `X-PAYMENT`. F-057 was a v1 reading.
→ FACTS F-065, DECISIONS D-018. Not a bug on either side of this transcript.

---

## S2-3 — walras's first on-chain settlement, verified (Q-008 cross-check, 2026-08-02)

Horizon, `GET /transactions/ac50c091…cc155`:

```
successful      : true
ledger          : 3935588
created_at      : 2026-08-02T19:07:53Z
source_account  : GATIEPZCNFNIORFMN3YYTBEPJDELAFX4TDKBXLUIBFHDNGEXXBKICWWI
fee_account     : GATIEPZCNFNIORFMN3YYTBEPJDELAFX4TDKBXLUIBFHDNGEXXBKICWWI
fee_charged     : 22973 stroops = 0.0022973 XLM
max_fee         : 33253 → (ours) 33153
operation_count : 1
```

Operation: `invoke_host_function` → `transfer`, asset balance change
`0.0100000 USDC` from `GACCDSSZ…` (buyer) to `GD7JFO5L…` (seller) — 100000 base units,
identical in shape and amount to the baseline settlement decoded in S0-4.

**stellar.expert**: `https://stellar.expert/explorer/testnet/tx/ac50c0910b3484ae6f2b070f35a95d1062dd3269cd4f877434dbcf2d7d3cc155`
resolves (HTTP 200), and `api.stellar.expert/explorer/testnet/tx/<hash>` returns the record
(ledger 3935588, protocol 27) with matching envelope XDR.

### Fee, cross-checked against Q-008

Every walras settlement this session charged **exactly 22 973 stroops** (12 of 12).
The x402.org baseline (F-054) charges 23 073 in its dominant cluster —
**exactly 100 stroops more**. The baseline settles through a fee-bump transaction
(F-055); a fee bump pays for (inner operations + 1), and one base-fee unit is 100 stroops.
The delta is precisely the fee-bump's own operation fee. The RFP's "about 0.0023 XLM"
(§2) holds for walras too. Observed `max_fee` 33 153, ~1.5× under the 50 000 ceiling (F-037).

### Balance accounting, exact to the stroop

After the demo payment and all ten e2e settlements (S2-4):

| Account | Before | After | Δ |
|---|---|---|---|
| buyer USDC | 20.0000000 | 19.9790000 | −0.021 = 1×0.01 (demo) + 11×0.001 (e2e) |
| seller USDC | 0 | 0.0210000 | +0.021 — every base unit arrived |
| facilitator XLM | 10000.0000000 | 9999.9724324 | −0.0275676 = **12 × 22 973 stroops** |

The facilitator paid every network fee and touched no USDC — the non-custodial,
fee-sponsoring property, now observed for **our own** operator rather than the reference one.

---

## S2-4 — The x402 repo e2e suite against walras (Q-004 run leg CLOSED, 2026-08-02)

### Setup

Per F-056, the suite lives at `e2e/` in the pinned clone. walras is exposed to the harness
as an external-proxy facilitator — a `test.config.json` + `run.sh` that exec's our **built,
unmodified** `packages/facilitator/dist/index.js`, mapping the harness env contract
(`STELLAR_PRIVATE_KEY` → `SUBMITTER_SECRET`, `STELLAR_NETWORK` → `NETWORK`,
`STELLAR_RPC_URL` → `RPC_URL`, `PORT` passthrough). Env: the three Stellar variables from
F-056 plus structurally-valid throwaway EVM/SVM keys, never funded — the stock client and
server construct EVM/SVM signers unconditionally at startup even when only Stellar is
exercised.

Invocation (programmatic mode, the suite's own filter mechanism):

```
pnpm test --facilitators=walras --servers=express,hono --clients=fetch,axios \
          --families=stellar --testnet
```

### Result: 4/4 scenarios pass — full output

```
🚀 Starting X402 E2E Test Suite
===============================

🤖 Programmatic Mode
===================

Active filters:
  - facilitators: walras
  - servers: express, hono
  - clients: fetch, axios
  - protocolFamilies: stellar

🌐 Network Mode: TESTNET
   STELLAR: Stellar Testnet (stellar:testnet)
   [EVM/SVM/APTOS/CCD/HEDERA/KEETA/TVM/NEAR/XRPL defaults printed but unused]

✅ 4 scenarios selected

🔍 Validating facilitator environment variables...
  ✅ All required environment variables are present

🏛️ Starting facilitator: walras on port 4024
⏳ Waiting for all facilitators to be ready...
  ✅ Facilitator walras ready at http://localhost:4024
🎭 Starting mock facilitator on port 4025...
  ✅ Mock facilitator ready at http://localhost:4025

🔧 Server/Facilitator combinations: 2
   • express + walras: 2 test(s)
   • hono + walras: 2 test(s)

[combo-0 express+walras] 🚀 Starting server: express (port 4022) with facilitator: walras
[combo-0 express+walras]   ✅ Server express ready
[combo-0 express+walras] 🧪 Test #1: axios → express → /exact/stellar via walras
[combo-0 express+walras]   ✅ Test passed
[combo-0 express+walras] 🧪 Test #2: fetch → express → /exact/stellar via walras
[combo-0 express+walras]   ✅ Test passed
[combo-1 hono+walras] 🚀 Starting server: hono (port 4023) with facilitator: walras
[combo-1 hono+walras]   ✅ Server hono ready
[combo-1 hono+walras] 🧪 Test #3: axios → hono → /exact/stellar via walras
[combo-1 hono+walras]   ✅ Test passed
[combo-1 hono+walras] 🧪 Test #4: fetch → hono → /exact/stellar via walras
[combo-1 hono+walras]   ✅ Test passed

📊 Test Summary
==============
🌐 Network: testnet
✅ Passed: 4
❌ Failed: 0
📈 Total: 4
⏱️  Duration: 2.99 min

📋 Detailed Test Results
========================

✅ PASSED TESTS:

  # 1: axios → express → /exact/stellar
      Facilitator: walras
      Network: stellar:testnet
      Tx: 6fbef5730ba0ae96913f694cc787ea7294e8f2abc9c7aedaeefbaa183f5f061e
  # 2: fetch → express → /exact/stellar
      Facilitator: walras
      Network: stellar:testnet
      Tx: ea4923f0aaf8115d1a2bbe331a89e67caf3d6b65597bf9f265f46ae403e78d1b
  # 3: axios → hono → /exact/stellar
      Facilitator: walras
      Network: stellar:testnet
      Tx: 7a0fcbaea7735b2d46010e4d2136e89e210554ae7056a7aa545adc85d52777f8
  # 4: fetch → hono → /exact/stellar
      Facilitator: walras
      Network: stellar:testnet
      Tx: ea26e506615b5444f76bf41ec2afe31fc0b49f0a45bde92cc71bab3c07bc3f44

📊 Breakdown by Facilitator:
 walras          ✅ 4 / ❌ 0 (100%)
📊 Breakdown by Server:
 express              ✅ 2 / ❌ 0 (100%)
 hono                 ✅ 2 / ❌ 0 (100%)
📊 Breakdown by Client:
   axios                ✅ 2 / ❌ 0 (100%)
   fetch                ✅ 2 / ❌ 0 (100%)
```

All four transaction hashes verified on Horizon: `successful=true`, ledgers
3935947 / 3935952 / 3935965 / 3935969, `fee_charged=22973` each, source `GATIEPZC…`
(walras). An earlier single-scenario run (`--servers=express --clients=fetch`) also passed
1/1 with tx `3453b6880ec0d1cdfe0dc86c75e811a3ca5455d57227eff85f396c4bf2725da9`, and the
first full-matrix attempt settled two further express payments before failing on the
fastify defect below — 11 e2e settlements total, all accounted for in S2-3.

### Two harness defects found at the pinned SHA (neither is a walras bug)

**(1) The mock facilitator omits `batch-settlement`.** The harness starts a mock
facilitator whose stated contract (its own header comment) is that it "claims to support
all schemes/networks", existing precisely so servers whose routes exceed the real
facilitator's kinds can still boot. Its `evmSchemes` list is `["exact", "upto"]` —
`batch-settlement` is missing — while the express/fastify/hono e2e servers configure
`batch-settlement` EVM routes unconditionally. Consequence: with **any** external
facilitator that is not a full EVM facilitator, the server's route validation throws
`RouteConfigurationError` on first request and the client sees an HTML 500 instead of a
402. Running against the bundled reference facilitator masks the gap because that
facilitator supports `batch-settlement` natively. Fix applied locally (one line, in test
scaffolding only — not in any stock client, server, SDK package, or walras):

```diff
-  const evmSchemes = ["exact", "upto"];
+  const evmSchemes = ["exact", "upto", "batch-settlement"];
```

**(2) The fastify e2e server never wires the mock fallback.** `express`, `hono`, and
`next` all read `MOCK_FACILITATOR_URL` and append the mock as a fallback facilitator
client; `servers/fastify/index.ts` does not reference it at all. It therefore cannot start
against any single-family facilitator, mock or no mock (both clients failed against it
with the same server-side 500; recorded in `logs/walras-stellar-s2-matrix2.log`, 4/6 pass
with only the two fastify scenarios failing). fastify was excluded from the final matrix
rather than patched — modifying a server component under test crosses the line that a
scaffolding fix does not. Both defects are upstream-reportable → DECISIONS D-019, D-020.

---

## S2-5 — Diff against the Session 0 x402.org baseline (2026-08-02)

What Session 0 captured from the baseline operator: `/supported` (S0-2) and settled
transaction anatomy (S0-4). A baseline 402/PAYMENT-SIGNATURE transcript does not exist —
Q-011 was blocked precisely because no funded stock client existed then — so the wire legs
are diffed against the pinned spec and SDK source, per D-010's framing.

| Dimension | walras (observed S2) | Baseline / normative source | Verdict |
|---|---|---|---|
| `/supported` Stellar kind | `{x402Version:2, scheme:"exact", network:"stellar:testnet", extra:{areFeesSponsored:true}}` | Identical, byte-for-byte field-wise (S0-2, F-041) | **identical** |
| `/supported.signers` | `{"stellar:*": [1 address]}` | Same shape, 2 addresses (F-041) | count = operator config; shape identical |
| `/supported.extensions` | `[]` | `["builder-code","eip2612GasSponsoring","erc20ApprovalGasSponsoring"]` | deliberate — D-016: advertise only what is reachable; baseline's entries are EVM-only features walras does not serve |
| 402 headers | `PAYMENT-REQUIRED` (v2) | `specs/transports-v2/http.md` canonical | **matches spec**; F-057 corrected (D-018) |
| Payment header | `PAYMENT-SIGNATURE` | same source | **matches spec** |
| Receipt header | `PAYMENT-RESPONSE` | same source | **matches spec** |
| `/verify` request/response | §7.1 envelope; `{isValid, payer}` | spec §7.1; SDK `HTTPFacilitatorClient` | **matches** |
| `/settle` response | `{success, transaction(64-hex), network, payer}` | spec §Phase 3 (F-038) | **matches** |
| Settled op anatomy | 1 op, `invoke_host_function` → `transfer(from,to,i128)`, USDC SAC `CBIELTK6…` | identical (S0-4) | **identical** |
| Settlement fee | 22 973 stroops | 23 073 stroops | Δ = exactly 100 stroops = the fee-bump operation's base fee — see next row |
| Fee account | `source_account == fee_account` | `source ≠ fee_account` (fee-bump, F-055) | config, not wire shape: `FEE_BUMP_SECRET` unset this session; the knob exists and is spec-optional → D-021 |
| Payer in responses | client address, never facilitator | same (F-038) | **identical** |

**Zero unexplained differences.** Each divergence is either byte-identical, an explained
operator-configuration difference, or a Session 0 fact-error corrected at source
(F-057 → F-065).

---

## S2-6 — Negative live tests: each rejected with a non-null reason (2026-08-02)

All three run against the live facilitator on `stellar:testnet` with real payloads produced
by the stock client path. No stock component was modified.

### 1. Replayed payload → `/settle`

The exact settle body that produced `ac50c091…` (captured on the wire at the facilitator
tap) was POSTed to `/settle` a second time, verbatim:

```
HTTP/1.1 200 OK
{"success":false,"network":"stellar:testnet","transaction":"",
 "errorReason":"invalid_exact_stellar_payload_simulation_failed",
 "payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK",
 "errorMessage":"Re-simulation of the transaction against current ledger state did not succeed."}
```

D-011's claim — replay resistance is structural, enforced by Soroban nonce consumption and
surfaced through mandatory re-simulation — is now **demonstrated live**, with the consumed
nonce of a real prior settlement.

### 2. Amount mismatch → `/verify`

The captured verify body with `paymentRequirements.amount` changed `"100000"` → `"200000"`
(payload untouched):

```
HTTP/1.1 200 OK
{"isValid":false,"invalidReason":"invalid_exact_stellar_payload_wrong_amount",
 "payer":"GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK",
 "invalidMessage":"The transfer amount does not equal paymentRequirements.amount exactly."}
```

A structural check, reachable **before** simulation — consistent with F-064's ordering.

### 3. Expired auth entry → `/verify` and `/settle`

A payload was produced by the stock client assembly path
(`x402Client.createPaymentPayload` → client `ExactStellarScheme`;
[demo/negative-payload.ts](../demo/negative-payload.ts)) against the same requirements with
`maxTimeoutSeconds: 15`, giving `signatureExpirationLedger = 3935653` at creation ledger
3935650. After the chain passed ledger 3935657 (beyond the bound *plus* the package's
2-ledger tolerance, F-046), both endpoints rejected it:

```
POST /verify  → {"isValid":false,"invalidReason":"invalid_exact_stellar_payload_simulation_failed", …}
POST /settle  → {"success":false,"errorReason":"invalid_exact_stellar_payload_simulation_failed", …}
```

As F-064 predicted, on live testnet the expired case collapses into
`…_simulation_failed` — the Soroban host itself refuses the expired auth entry during
simulation, and the package's own expiry-bound code (`invalid_exact_stellar_signature_expiration_too_far`)
sits *after* simulation and is only observable against the RPC double (S1-4). The
RFP 3.6 requirement — non-null reason on every rejection — holds in all three cases, live.

---

## S3-1 — Session 3 pre-flight gates and verification reads (2026-08-02)

### G3.1 — Session 2 state reproducible

`pnpm test` at session start: **76/76 pass** (5 files), unchanged from the S2 close.
EVIDENCE S2-1 … S2-6 present; FACTS Q-011/Q-004 CLOSED.

### G3.2 — Q-001 tables present

FACTS rows confirmed in place before any code: F-025 (seven filters + defaults),
F-031 (service-metadata soft-drop), F-030 (routeTemplate: percent-decode **before**
`..`/`://` checks), F-024 (EXTENSION-RESPONSES: base64 JSON, `status` ∈
success|processing|rejected, `rejectedReason` optional, header itself a MAY),
F-029 (MCP tuple keying MUST).

### Verification reads before implementing (method rule 3)

1. `specs/extensions/bazaar.md` re-read in full at `17fc9890…` (589 lines).
2. `typescript/packages/extensions/src/bazaar/*` read at the SHA — produced F-072
   (the one-shot extractor is not a trust boundary) and confirmed F-048's helper list.
3. Reference e2e catalog (`e2e/facilitators/typescript/bazaar.ts`) read — confirms
   D-009 (keys on URL alone, violating the MCP tuple MUST; walras does not copy it).
4. Live probe: `node:sqlite` on the pinned Node v24.14.0 — `DatabaseSync` works,
   `PRAGMA journal_mode=WAL` returns `wal` on a file-backed DB, module emits
   `ExperimentalWarning` (F-070, D-023).
5. License gate for the one new dependency: `@x402/extensions@2.20.0` is Apache-2.0;
   its transitive deps are MIT/Apache-2.0/Unlicense. Full-tree re-scan after install:
   `GATE G-LIC: PASS — no copyleft or undeclared licenses in tree` (F-071).

---

## S3-2 — Unit + poisoning suites (2026-08-02)

`pnpm test` across the workspace after the build: **132/132 pass** —
`@walras/bazaar` 45 tests (2 files), `@walras/facilitator` 87 tests (6 files, one new:
`test/discovery.test.ts`).

Trust-boundary cases proven in-process (all against the real store; the facilitator-level
cases drive the real `ExactStellarScheme` through the Soroban RPC double, D-017):

- **Trivial-schema attack**: client-authored `schema: {type:"object"}` + garbage
  `info.input.type` passes Ajv (the client wrote the schema) and is rejected by the
  protocol-invariant check → `bazaar_spec_validation_failed`. This is why the indexer
  composes the SDK's helpers instead of calling `extractDiscoveryInfo` (F-072).
- **routeTemplate traversal**: `%2e%2e`, `..`, `://`, and no-leading-`/` templates are
  field-dropped (percent-decode first, F-030) and the listing lands under the concrete
  path — soft-drop, never rejection.
- **Service-metadata soft-drop** (F-031): 33-char serviceName dropped, loopback-IP
  iconUrl dropped, tags case-insensitively deduped and capped at 5 — listing survives.
- **Write poisoning** (D-024): a listing owned by payTo A cannot be created over,
  overwritten, or partially modified by a settled payment to payTo B — verified at the
  store layer, the indexer layer, and over HTTP; original listing byte-identical after
  the attempt.
- **The D-015 invariant test**: with a deliberately broken store injected, `POST /settle`
  still returns `success: true` with a 64-hex hash and **no** EXTENSION-RESPONSES header
  (a walras fault is never reported as a client rejection).
- **MCP tuple keying** (F-029): same URL holds an HTTP listing and two MCP tool listings
  as three distinct rows.

---

## S3-3 — Live flow on `stellar:testnet`: settle → automatic catalog entry (2026-08-02)

### Topology

walras facilitator (`dist`, port 4021, fresh empty catalog DB) ← stock `@x402/express`
seller (port 4022) ← stock `@x402/fetch` buyer. The seller's only S3 change is the
route-config declaration — stock `declareDiscoveryExtension` plus `description`,
`mimeType`, `serviceName: "Walras Demo Weather"`, `tags: ["weather","demo"]`; the stock
middleware auto-registers `bazaarResourceServerExtension` itself. **No registration call
exists anywhere in the demo.**

Pre-state: `/supported` now advertises `extensions: ["bazaar"]` (D-016 satisfied in the
same change that mounted the endpoint); `/discovery/resources` returns
`{x402Version:2, items:[], pagination:{limit:20, offset:0, total:0}}`.

The seller's 402 `PAYMENT-REQUIRED` header decodes to the full bazaar extension with the
method-narrowed schema (`enum: ["GET"]`) and the service metadata on `resource` — spec
shape exactly.

### The payment, and the catalog entry it created

Stock buyer output:

```json
{ "status": 200, "body": { "report": "sunny", "temperatureC": 31 },
  "paymentResponse": { "success": true,
    "payer": "GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK",
    "transaction": "81c4baac7e7766610a945b56abfac7b0893d75f54f3e6f32fd8113b471b99b3f",
    "network": "stellar:testnet" } }
```

The **stock seller middleware** parsed walras's settle response header and logged, verbatim:

```
[x402] extension responses: {"bazaar":{"status":"success"}}
```

`GET /discovery/resources` immediately after — one item, no registration step having
occurred:

```json
{ "resource": "http://127.0.0.1:4022/weather", "type": "http", "x402Version": 2,
  "accepts": [{ "scheme": "exact", "network": "stellar:testnet",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "amount": "100000", "payTo": "GD7JFO5L4WP7FGRFB33ATR5NJF2FWSC5FTOAKCAYWUMIBMNHFURKNI3R",
    "maxTimeoutSeconds": 300, "extra": { "areFeesSponsored": true } }],
  "lastUpdated": "2026-08-02T20:23:53.505Z",
  "description": "Live weather report for the walras demo city",
  "mimeType": "application/json", "serviceName": "Walras Demo Weather",
  "tags": ["weather", "demo"], "extensions": { "bazaar": { … full info + schema … } } }
```

`accepts` is the verified requirements of the settled payment; the input/output schemas
and per-parameter descriptions ride in `extensions.bazaar`. Filtered queries return the
same item for `type=http`, `payTo=<seller>`, `scheme=exact`, `network=stellar:testnet`,
`extensions=bazaar` (all seven filters exercised, D-005); `limit=abc` gets
`400 {"error":{"code":"walras_invalid_query_parameter", …}}`.

Live catalog DB confirmed in `journal_mode: wal` with the single row
`(resource, type='http', tool_name='', owner_pay_to=<seller>)` (F-029 keying).

---

## S3-4 — Live hostile client: soft-drop with reason, settlement untouched (2026-08-02)

Both cases use [demo/hostile-client.ts](../demo/hostile-client.ts): the *payment* is
produced by the stock client path and is honest; the echoed `resource`/`extensions` are
tampered after signing and POSTed straight to `/settle` — the exact threat model the spec
names for the facilitator trust boundary.

### 1. Garbage extension (trivial-schema attack), paying the legitimate seller

Settlement **succeeded on-chain** — tx
`af1bcbfaa885e01ccaa0d12dfbeeb1bd39ef967e163a0d005665e420e534bd82` — while the
extension was soft-dropped with machine code and human reason in one header:

```json
{ "bazaar": { "status": "rejected",
  "rejectedReason": "The discovery info violates the bazaar protocol invariants. info.input.type must be \"http\" or \"mcp\", got \"garbage\"",
  "code": "bazaar_spec_validation_failed" } }
```

Catalog after: unchanged (1 listing, the seller's own).

### 2. Poisoning attempt: real settled payment, wrong payee

The attacker paid **itself** 0.01 USDC (a structurally valid self-transfer the payment
scheme correctly settles) while claiming the seller's URL with a *well-formed* extension.
Settlement succeeded — tx
`66da73958ad3b20fc327c7baac763d693d926de7c15121fd9e742d2440a042d4`, payer = attacker —
and the catalog write was refused:

```json
{ "bazaar": { "status": "rejected",
  "rejectedReason": "This resource is already cataloged for a different payment recipient; a listing can only be updated by payments to its original payTo.",
  "code": "bazaar_listing_owned_by_other_payee" } }
```

Catalog after: the seller's listing intact, `description` unchanged, accepts payTo set =
`{<seller>}` only; `?payTo=<attacker>` returns `total: 0`. **A real, settled payment was
not sufficient to touch another seller's listing** (D-024).

### On-chain verification and accounting

All three S3 transactions verified successful on Horizon:

| tx | ledger | fee (stroops) | note |
|---|---|---|---|
| `81c4baac…9b3f` | 3936498 | 22 973 | stock buyer → seller (cataloged) |
| `af1bcbfa…bd82` | 3936505 | 22 973 | garbage-mode payment → seller (soft-dropped) |
| `66da7395…42d4` | 3936510 | 18 374 | poison-mode self-transfer (soft-dropped) |

The two seller payments charge exactly the F-069 fee (22 973); the self-transfer's
smaller footprint prices lower — fees remain simulation-derived per F-037. USDC exact:
buyer 19.979 → **19.959** (two 0.01 payments; self-transfer net zero), seller
0.021 → **0.041**. The facilitator held USDC at no point.

---

## S4-1 — Gate G4.1: catalog seeded by 11 real settlements on `stellar:testnet` (2026-08-03)

Topology unchanged from S3-3 (walras dist :4021 ← stock seller :4022 ← stock buyer), but
the seller's route table is now data-driven from `eval/search/corpus.json` — 11 resources
in four deliberately overlapping vocabulary clusters (weather/air, finance/markets,
geo/network, language), each with per-parameter JSON-Schema descriptions, 9 × GET +
2 × POST. The catalog was populated the only way walras allows: one real settled payment
per resource (`demo/seed-catalog.ts`, stock `@x402/fetch` path throughout).

All 11 settlements succeeded, $0.01 USDC each:

```
weather-current  48cfaea1512ff4d656ef0dbb89e01e4aca33404bdff1de9820aa3e87f08eb8fe
weather-history  506d79617326334769232db8936802e6a7d87b41a8ef6802bb07ac9e92086650
air-quality      a6250266706821deaccf92397309db53546a0177d3449b54ec690f0732efd132
fx-rates         810cfdd0ac2b7c5f1432974d3b4f16dad084df193712311e65e1abaabf174dde
stock-quote      784ae3d9697fb7b460d7aeebb5d20901cbbadfa6e766c88007c70be33333d8b8
crypto-price     b457b20f577c9bf4ef67a1e824296208fca5e5fdb2c8ff0573ba69edeb636f8a
geocode-forward  ab5b59e16bc5d06e3b3990d34a0034321d8e528c64375b4ae5b2c3bbc90381ed
geocode-reverse  fef8962b4ff67934dce0229248e4d90e532e42ecbfe2502f40908b5899703cce
ip-info          6943b27c260b81d0cea84ac7ab8cf12562c43fbf1252a567ec2c2741aafc56f8
sentiment        5adbe87a434b0495c6734dfe3145eb6f5b8ec339a210b279f36b1410e9927a86
translate        ad763c3912af2ad8b8c8d6439aadb518e29dab9d1b8e420197216b8c44f7d08b
```

Horizon spot-checks (first and last): `48cfaea1…` ledger 3936817 and `ad763c39…` ledger
3936837, both `successful: true`, both `fee_charged: 22973` — the S2 measured constant
(F-069) exactly, sourced by the walras submitter `GATIEP…`. Immediately after:
`GET /discovery/resources?limit=100` → `pagination.total: 11`, with per-parameter
descriptions verified present in the stored `extensions.bazaar.schema` for both the GET
(`queryParams`) and POST (`body`) shapes. **G4.1 PASS** (≥5 required, 11 seeded).
Catalog listing: `demo-logs/catalog-s4-after-seed.json`.

---

## S4-2 — FTS5/BM25 availability probe on the pinned toolchain (2026-08-03)

Live probe on Node v24.14.0, `node:sqlite`:

- `PRAGMA compile_options` includes **`ENABLE_FTS5`**; `sqlite_version()` = **3.51.2**.
- FTS5 virtual table + `bm25()` work; scores are **negative**, smaller = more relevant
  (`ORDER BY rank` ascending = best first): match on "weather forecast" scored
  `-1.4563…`.
- Raw operator text in MATCH **throws**: `what's the "best- weather: today? (NEAR` →
  `fts5: syntax error near "'"`. Quoted-token form `"weather" OR "best" OR "today"`
  returns ranked rows. This is why the retriever compiles untrusted queries instead of
  passing them through (D-026).

Recorded as F-076.

---

## S4-3 — Test suite and baseline search-quality numbers (2026-08-03)

`pnpm test`: **157/157** (bazaar 64, facilitator 93) — up from 132 in S3. New coverage:
sanitizer hostility, ranking sanity, per-param-description matching, FTS/catalog
transactional sync (incl. ownership-conflict leaves index untouched), backfill of a
pre-search database, exactly-once cursor walks, foreign/malformed cursor rejections,
retrieval-cap honesty, and the endpoint's spec shape + rejection codes.

`pnpm eval:search` (BASELINE fts5-bm25, weights name 4 / desc 2 / params 1 / tags 3;
fixture catalog built through the production indexer; corpus sha256 `094a953dfa0ecafb…`):

| Metric | Value |
|---|---|
| recall@1 | **0.839** |
| recall@3 | **0.929** |
| recall@5 | **0.929** |
| MRR@10 | **0.911** |
| nDCG@5 / nDCG@10 | **0.909** / **0.909** |
| zero-result queries | 0 / 28 |

The misses are exactly the planted vocabulary-gap probes: "convert US dollars to euros"
(corpus says USD/EUR) and "did it snow in Oslo in January 2019" (corpus says "snowfall";
no stemming) rank wrong resources first via stopword noise ('to', 'in' match parameter
prose); "apple share price today" ranks crypto-price above stock-quote (no
apple→AAPL knowledge). These are the measured acceptance tests for the GRANT-scope
upgrades (ARCHITECTURE §7.3). Full per-query table:
`eval/search/results/2026-08-03.json`.

---

## S4-4 — Live `/discovery/search` on the seeded testnet catalog (2026-08-03)

The facilitator was restarted on the S4 build over the S4-1 catalog — a database created
by the pre-search schema — and the open-time backfill indexed all 11 listings with no
migration step. Probe transcript (`demo-logs/search-s4-live.log`):

- `query=usd eur exchange rate&limit=3` → `resources: [fx/rates, crypto/price]`,
  `partialResults: false`, `pagination: {limit: 2, cursor: null}` — note `limit` is the
  count in this page (F-077), and the requested 3 was not padded.
- Cursor walk, `limit=4` over a 7-token query matching 10 listings: pages of 4 + 4 + 2,
  `partialResults` true → true → false, final cursor `null`, **10 unique resources, no
  duplicates** — exactly-once confirmed on the live wire.
- Filters: `payTo=<seller>&network=stellar:testnet&type=http` narrows; a wrong network
  returns `resources: []` with `partialResults: false`.
- Rejections, all machine-readable: missing query → 400
  `walras_missing_search_query`; foreign cursor `eyJ2Ijo5OX0` → 400
  `walras_invalid_search_cursor`; and the hostile-syntax query
  `"weather: (NEAR today*" -` → **200 with sane ranked results** (the sanitizer, live).

---

## S5-1 — Session 5 pre-flight gate G5.1 (2026-08-03)

**Evidence present**: sections S2-1 … S2-6, S3-1 … S3-4, S4-1 … S4-4 all present in this
file (header scan). FACTS Q-011/Q-004 CLOSED; F-065 … F-077 in place.

**Clean-clone install works**: `git clone` of the working tree into a scratch directory,
then with nothing but the lockfile:

```
pnpm install --frozen-lockfile     → Done in 5.6s
pnpm build                         → @walras/bazaar tsc OK, @walras/facilitator tsc OK
pnpm test                          → exit 0; facilitator 7 files, 93/93 pass
                                     (workspace total 157 with @walras/bazaar, as S4-3)
```

**Search eval reproduces in the clean clone** — `pnpm eval:search` re-run there on
2026-08-03, without touching this repo's committed `eval/search/results/2026-08-03.json`:

```
MEAN over 28 queries (0 zero-result)   R@1 0.84  R@3 0.93  R@5 0.93  MRR 0.91
nDCG@10: 0.91
```

Identical to S4-3 to every printed digit.

**License gate G-LIC re-run** (final assembly, 2026-08-03):

```
--- direct @x402/* and @stellar/* ---
  @stellar/js-xdr@4.0.0            Apache-2.0
  @stellar/stellar-sdk@16.2.0      Apache-2.0
  @x402/core@2.20.0                Apache-2.0
  @x402/express@2.20.0             Apache-2.0
  @x402/extensions@2.20.0          Apache-2.0
  @x402/fetch@2.20.0               Apache-2.0
  @x402/stellar@2.20.0             Apache-2.0

GATE G-LIC: PASS — no copyleft or undeclared licenses in tree
```

---

## S5-2 — The one-command demo, live on `stellar:testnet` (2026-08-03)

`./scripts/demo.sh`, one command, no arguments, against a **fresh empty catalog**
(`data/demo-catalog.db` wiped at boot). Full transcript at
`demo-logs/run-20260803T061126Z-happy/`; the essential frames, verbatim:

```
== 1/5 the catalog starts EMPTY — nothing is listed until something settles ==
GET http://127.0.0.1:4021/discovery/resources -> total: 0

== 2/5 first payment: the stock client pays /weather — settling IS listing ==
{"id":"weather-current","status":200,"transaction":"69a3078e59a05c3bc0a6712332b8938f28830810e0c3168c0d794d0bf3a560aa","network":"stellar:testnet"}

the stock seller middleware just logged walras's EXTENSION-RESPONSES header:
  [x402] extension responses: {"bazaar":{"status":"success"}}
catalog total is now: 1 — auto-listed, no registration call exists anywhere

== 4/5 agent: search -> pay -> hash ==
GET http://127.0.0.1:4021/discovery/search?query=current+weather+in+Zurich&network=stellar%3Atestnet&limit=5
3 result(s), partialResults=false, ranked:
  1. Walras Demo Weather — http://127.0.0.1:4022/weather
  2. Walras Demo Markets — http://127.0.0.1:4022/crypto/price
  3. Walras Demo Weather — http://127.0.0.1:4022/weather/history

== agent: paying the top result ==
request  : GET http://127.0.0.1:4022/weather?city=Zurich&units=metric
price    : 100000 base units = 0.01 USDC on stellar:testnet
HTTP 200
body     : {"city":"Zurich","condition":"sunny","temperatureC":24,"windKph":11,"humidityPct":48}
settled  : tx f2857a0b3af17567eaaa77638a0fcc76045a602605dfd732c7dac204010c3914
explorer : https://stellar.expert/explorer/testnet/tx/f2857a0b3af17567eaaa77638a0fcc76045a602605dfd732c7dac204010c3914
fee      : 22973 stroops = 0.0022973 XLM (ledger 3943548, successful=true)

== agent: the catalog entry this settlement just refreshed ==
lastUpdated: 2026-08-03T06:11:51.364Z (at search time) -> 2026-08-03T06:12:36.222Z (now)

DEMO: PASS — search -> pay -> hash -> auto-listed, all live on stellar:testnet
```

Five real settlements in one run, every fee exactly the F-069 figure:

| leg | tx | fee (stroops) |
|---|---|---|
| seed `weather-current` | `69a3078e…60aa` | 22 973 |
| seed `weather-history` | `62823bcd…1c42` | 22 973 |
| seed `fx-rates` | `885d8c12…cada6`* | 22 973 |
| seed `crypto-price` | `e5e75eef…0f88` | 22 973 |
| **agent** (search → pay) | `f2857a0b…3914` | 22 973 (Horizon-confirmed in-run) |

\* full hash `885d8c126eb3f33dd52590b02682c780ffd8fc66b1959fac72ce48d7398cada6`.

The agent request was built entirely from the **catalog listing** (`method` and
`queryParams` from `extensions.bazaar.info.input`) — the agent never saw the seller's
docs. Its query `current weather in Zurich` is the first labeled query of the S4-3 eval
set, and the live ranking matched the eval's expectation (`weather-current` first).

---

## S5-3 — Negative-path demo flags: three machine-readable rejections (2026-08-03)

### `./scripts/demo.sh --tampered` — requirements claim double the signed amount

The stock client signs a 100 000 base-unit transfer; the POSTed requirements claim
200 000 (exactly the S2-6 §2 tamper, now scripted). Rejected **pre-simulation** (F-064):

```
POST /verify -> HTTP 200
{ "isValid": false,
  "invalidReason": "invalid_exact_stellar_payload_wrong_amount",
  "payer": "GACCDSSZLK3YZ62NXDOY7IIGHYMQYB6PVPURMHHXK6GBDN7ZFMOZH4WK",
  "invalidMessage": "The transfer amount does not equal paymentRequirements.amount exactly." }

DEMO --tampered: PASS — rejected with invalid_exact_stellar_payload_wrong_amount
```

### `./scripts/demo.sh --expired` — auth entry allowed to expire

Stock-built payload with `maxTimeoutSeconds: 15` (`createdAtLedger 3943595`,
`signatureExpirationLedger 3943598`); the script waits until the chain is 2+ ledgers
past the bound — margin against RPC-view skew between the script and the facilitator
(2 is the same skew constant the package uses for its own bound check, F-046; expiry
itself is enforced strictly by the Soroban host during simulation, F-064) — before
submitting:

```
  latest ledger: 3943601
POST /verify -> {"isValid":false,"invalidReason":"invalid_exact_stellar_payload_simulation_failed", …}
POST /settle -> {"success":false,"errorReason":"invalid_exact_stellar_payload_simulation_failed", …}

DEMO --expired: PASS — rejected with invalid_exact_stellar_payload_simulation_failed
```

As F-064 documents, the expired case surfaces live as `…_simulation_failed` — the Soroban
host refuses the expired auth entry during mandatory re-simulation.

### `./scripts/demo.sh --poison-catalog` — a REAL settled payment cannot poison the catalog

The seller is listed by a legitimate settlement (`751fdb68…e635`), then the attacker pays
**itself** on-chain while claiming the seller's URL:

```
  settlement          : success=true tx b44084d1e614864a2696c00b2ab600747df4078b594a59d50fed63a390a92af6
  EXTENSION-RESPONSES : {"bazaar":{"status":"rejected","rejectedReason":"This resource is
    already cataloged for a different payment recipient; a listing can only be updated by
    payments to its original payTo.","code":"bazaar_listing_owned_by_other_payee"}}

== 3/3 the catalog is untouched ==
  seller listing byte-identical after the attack: true
  listings owned by the attacker: 0

DEMO --poison-catalog: PASS — a real settled payment could not touch another seller's listing
```

**Post-review hardening, re-validated live** (2026-08-03, runs
`run-20260803T172550Z` … `run-20260803T172916Z`): an adversarial review pass over the
demo scripts produced seven confirmed findings (exact-code gates, refresh assertion,
`.env` placeholder shadowing, dotenv/bash parser divergence, poison stderr capture,
`SEED_IDS` contract, F-046 citation direction — all fixed), after which **all four modes
re-ran PASS**: agent tx `8977504d…edc8` (fee again 22 973), and the happy path now
prints `lastUpdated … (bumped by this settlement — asserted)`.

All three flags end in a **machine-readable reason extracted from the live response**,
never hardcoded — and the gates demand the **exact expected code**
(`…_wrong_amount`, `…_simulation_failed`, `bazaar_listing_owned_by_other_payee`): a
generic rejection such as `walras_internal_error`, or a misconfiguration 400, fails the
demo rather than passing it. The happy-path agent likewise **asserts** that its
settlement bumped the listing's `lastUpdated` past the search-time value instead of
merely printing the two timestamps.

---

## S5-4 — Final assembly: where every RFP deliverable's evidence lives

| Deliverable | Evidence |
|---|---|
| Stock-client conformance transcript + tx hash | S2-2, S2-3 — tx `ac50c091…cc155`, Horizon + stellar.expert verified |
| x402 repo e2e suite against walras | S2-4 — 4/4 pass (express, hono × fetch, axios), 11 settlements |
| Measured settlement fee | S0-4 (baseline 23 073), S2-3 + S5-2 (walras: **22 973 stroops = 0.0022973 XLM**, uniform across all 17 observed settlements) |
| Baseline-vs-walras transcript diff | S2-5 — byte-level diff summary against the x402.org capture |
| License scan (G-LIC) | S0-5, re-run S3-1, **final re-run S5-1: PASS, zero copyleft** |
| Search eval table | S4-3, independently reproduced in a clean clone (S5-1): R@1 0.84, R@3/5 0.93, MRR@10 0.91, nDCG@10 0.91, 0 zero-result |
| Settle-gated cataloging, hostile-input defenses | S3-2 (132-test suite incl. poisoning), S3-3/S3-4 (live), S5-3 (scripted, repeatable) |
| One-command demo | S5-2 (`scripts/demo.sh`), S5-3 (negative flags) |
| Reproducibility | S5-1 (clean clone), S5-5 (timed README walkthrough) |

### Demo recording checklist — 90-second storyboard

Storyboard (matches the natural pacing of `./scripts/demo.sh`, which runs ≈100 s
wall-clock on a warm build):

| t | frame |
|---|---|
| 0:00 | One command: `./scripts/demo.sh`. Facilitator boots on a **fresh empty catalog**; on screen: `GET /discovery/resources -> total: 0` |
| 0:10 | First stock-client payment settles → tx hash prints; seller middleware logs `EXTENSION-RESPONSES: {"bazaar":{"status":"success"}}`; `catalog total is now: 1 — auto-listed` |
| 0:25 | Three more routes seeded the same way (cut/fast-forward) |
| 0:40 | Agent: `GET /discovery/search?query=current+weather+in+Zurich` → ranked results on screen |
| 0:50 | Agent pays the top hit via the stock client → `HTTP 200`, settled tx hash, stellar.expert link, `fee: 22973 stroops` |
| 1:10 | Catalog entry re-fetched: `lastUpdated` visibly bumped by that settlement |
| 1:20 | Close on `DEMO: PASS — search -> pay -> hash -> auto-listed`; optional stinger: `--poison-catalog`'s `seller listing byte-identical after the attack: true` |

Pre-flight for the recording: terminal ≥14 pt, ~100 columns; run the demo once first so
the build is warm and testnet latency is the only wait; have the stellar.expert tab ready
to paste the printed hash; `.env` never on screen (it is the only secret-bearing file);
raw logs land in `demo-logs/run-<stamp>-happy/` if a retake needs stitching.

---

## S5-5 — README quickstart, timed from scratch (2026-08-03)

Measured on this codespace (4-core dev container, warm npm registry + pnpm store cache),
following the README top to bottom against commit `fed532b`:

| step | command | measured |
|---|---|---|
| clone | `git clone` (local) | < 1 s |
| install | `pnpm install` | **5 s** (warm store; the S5-1 frozen-lockfile install measured 5.6 s) |
| account setup | `node scripts/setup-accounts.mjs` | **25 s** (3 accounts Friendbot-funded, 2 USDC trustlines) |
| manual USDC faucet | faucet.circle.com (captcha) | human step, ~2–5 min (S2 measurement: minutes, not hours) |
| preflight | `pnpm preflight` | **3 s** — PASS |
| demo | `./scripts/demo.sh` | **65 s**, exit 0 — includes the first build and **five fresh on-chain settlements** |

Total machine time ≈ **1 min 40 s**; with the one human faucet step the full
"docs to a paid, discoverable endpoint" path lands around **5–8 minutes** — comfortably
inside the RFP's under-an-hour bar even on a cold cache.

The timed run doubled as the session's **self-validation** (fresh clone → README →
working demo, no undocumented steps). Its own settlement set, all fee 22 973 stroops:
seeds `b305f5b4…28eb`, `58f8284e…701d`, `1a4c0830…6ece`, `f2bf42b8…050a`; agent tx
`66ff439c39614f9b5d5660e15c18379d32c4aef460c480c05eb298c658bf5c07`
(`DEMO: PASS — search -> pay -> hash -> auto-listed`).

**Final-state validation caught a live congestion event — and the demo failed honestly.**
The post-hardening fresh-clone validation (commit `ccb982c`; `.env` built exactly as the
README instructs — `cp .env.example .env` + pasted setup-accounts fragment *including a
deliberately over-pasted `>>>` trailer*; `pnpm preflight` PASS, proving the parser-
divergence and placeholder-shadowing fixes) ran into real testnet congestion: the
`fx-rates` seed's `/settle` took **30.5 s** (versus 6–18 s for its neighbors in the same
run), exceeding the stock middleware's facilitator-client timeout. walras reported the
settle outcome, the stock seller re-issued 402, no funds moved for that attempt
(buyer balance verified on Horizon: exactly 3 × 0.01 USDC left the account, not 4), and
the demo **exited 1** rather than printing a false PASS. The seeder and agent then
gained one *visible* retry per payment (both attempts printed; a second failure still
fails the run), and the validation re-ran clean — see the closing run record below.

**Closing run — the state this pre-build ships in** (fresh clone of `9145156`, same
documented `.env` flow, 2026-08-03): `pnpm preflight` PASS; `./scripts/demo.sh`
**exit 0 in 66 s**, five settlements, no retries needed, refresh assertion green:

```
lastUpdated: 2026-08-03T17:54:28.197Z (at search time) -> 2026-08-03T17:55:12.876Z (bumped by this settlement — asserted)
  tx   e3e52cb6654bab2c58bb189ba0b1d4665f897e9d6b3805b5bcf8c308c368d433
  fee  22973 stroops
DEMO: PASS — search -> pay -> hash -> auto-listed, all live on stellar:testnet
```

Independent Horizon re-verification of the S5-2/S5-3 headline transactions (fees and
inclusion, queried out-of-band after the runs):

```
f2857a0b successful=true ledger=3943548 fee=22973 source=GATIEP… (agent, happy path)
b44084d1 successful=true ledger=3943565 fee=18374 source=GATIEP… (poison self-transfer)
69a3078e successful=true ledger=3943539 fee=22973 source=GATIEP… (first auto-listing seed)
```

The poison self-transfer's 18 374 stroops matches the S3-4 self-transfer fee to the
stroop; `source` is the walras submitter in every case — the facilitator sponsored every
fee, and the buyer never paid one (F-006).

---

## Not yet captured

| Section | Blocked on |
|---|---|
| **Fee-bump settlement by walras** | Config only (`FEE_BUMP_SECRET` + a funded fee account); knob shipped and unit-tested in S1. See D-021. |
| **MCP tool cataloged from a live MCP seller** | Out of pre-build scope. Tuple keying (F-029) is proven at store/indexer/HTTP level (S3-2); a live MCP seller is proposal scope. |
