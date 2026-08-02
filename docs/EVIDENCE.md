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

## Not yet captured

| Section | Blocked on |
|---|---|
| **Stock-client transcript** (Q-011) | A buyer account holding testnet USDC. The only documented funding path is the **captcha-gated Circle faucet** (faucet.circle.com, select Stellar) — not automatable from this session. Friendbot (XLM) and trustline creation are automatable; the USDC leg is not. |
| **S2 Conformance** | Same. Also gated on the facilitator existing (S1). |
| **S3 Discovery / poisoning tests** | S3 implementation. |
| **S4 Search eval metrics** | S4 implementation. |
| **S5 Demo run + recording** | S5. |

Fund one testnet account with USDC and both S0-6 and the local e2e run close.
