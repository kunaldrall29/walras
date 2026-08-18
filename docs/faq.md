# FAQ

The questions the [guides](./guides/sell.md) answer badly inline. Every answer
cites the FACTS row, DECISIONS entry, or document that makes it true.

### Why is my listing missing after a successful payment?

Cataloging is settle-gated *and* client-mediated: the listing is written only
when a payment settles **and** the client echoed your bazaar extension from the
402 into the payment payload — if the client omits the echo, no cataloging
occurs and the seller cannot force it (D-004, F-032). Check the
`EXTENSION-RESPONSES` header on your settle response: a `rejected` status
carries a human `rejectedReason` plus a machine `code` naming the defect
(D-014). Also note that invalid optional fields (`serviceName`, `tags`,
`iconUrl`, `routeTemplate`) are soft-dropped individually — the listing appears
but without the offending field (F-030, F-031).

### Why did my payment expire?

Validity is ledger-bounded, not wall-clock: the auth entry expires
`ceil(maxTimeoutSeconds / estimatedLedgerSeconds)` ledgers after creation —
~12 ledgers ≈ 60 s at the spec's illustrative 60 s default (F-034). The stock
`@x402/express` middleware actually defaults `maxTimeoutSeconds` to 300, not 60
(the F-066 note), so short expiries usually mean a seller set a tight value or a
payload was held too long before submission. An expired payload surfaces as
`invalid_exact_stellar_payload_simulation_failed`: the Soroban host refuses the
expired entry during mandatory re-simulation (F-064).

### Why does a rejected payment return HTTP 200?

Because the exchange succeeded — it is the payment that is invalid. `/verify`
returns 200 with `isValid: false` and a reason code; `/settle` returns 200 with
`success: false` — matching the reference facilitator, with 4xx reserved for
requests that could not be interpreted as an x402 exchange at all
(ARCHITECTURE §3.2). Branch on `isValid` / `success` and the code, never on the
HTTP status.

### Why does search return `resources` while list returns `items`?

Because the SDK wire types differ, deliberately:
`DiscoveryResourcesResponse.items` for the list endpoint,
`SearchDiscoveryResourcesResponse.resources` for search (F-027). walras
implements the asymmetry exactly, because a stock client would silently read
`undefined` — an empty result list, not an error — if both were normalized to
one name (D-001).

### Why does `?q=...` return nothing?

The spec names the search parameter `query`, not `q` (F-026, D-006). walras
answers the missing parameter with a 400 carrying
`walras_missing_search_query`, whose message points at the right name (D-027) —
so a hand-typed `q=` gets a correction, not an empty result.

### Does walras hold my funds?

No. The scheme rejects any payload in which a facilitator address is the
transaction source, operation source, the transfer's `from`, or an auth-entry
participant (F-035), and the settlement receipt's `payer` is always the buyer's
address, never the facilitator's (F-038). The transfer is buyer → seller
on-chain; walras only rebuilds, submits, and sponsors the network fee (F-006).

### Is mainnet supported?

The configuration accepts `stellar:pubnet`, which requires an explicit
`RPC_URL` because pubnet has no public default RPC (F-004). But every live
transcript in [EVIDENCE.md](./EVIDENCE.md) is `stellar:testnet`, and mainnet
operation is planned, unaudited today — a third-party security review is
planned before any mainnet production tag (THREAT-MODEL §4).

### What does a payment cost?

The buyer pays the resource's price and nothing else — no network fee, no
sequence number, because the submitter sponsors the fee (F-006). The operator's
cost is measured at 22 973 stroops = 0.0022973 XLM per settlement on the
single-submitter path (F-069); the fee-bump path costs 100 stroops more,
23 073 (F-086).

### Why did the facilitator refuse to start?

Exit code 78 (`EX_CONFIG`) means a configuration variable failed validation;
the error message names it, and the process exits before binding a port
(ARCHITECTURE §3.4) — a facilitator that starts half-configured would advertise
capability it cannot honour. Fix the named variable against the generated
[configuration reference](./reference/config.md).

### Can I register a listing without paying?

No, by design (D-022). Settlement *is* registration: every listing in the
catalog exists because a real payment settled on-chain, which is the catalog's
anti-spam property (D-004). If you need to preview how your extension would
validate, the current answer is a testnet settlement; a validation dry-run
endpoint is a possibility recorded for the funded build (D-022).

### What happens if the catalog database breaks?

Settlements are unaffected: the settle response is produced from the chain
result alone, the indexer never throws by contract, and a forced-failure test
pins settlement success against a deliberately broken store (D-015). Discovery
degrades — the two `/discovery/*` endpoints fail or serve stale data — until
the store is restored from backup, per the [runbook](./runbook.md) §3. An
internal indexer fault omits the `EXTENSION-RESPONSES` header entirely rather
than blaming the client's payload (D-025).
