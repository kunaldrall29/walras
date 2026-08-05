# walras — abstract

*One-page summary of the [litepaper](./walras-litepaper.md). Testnet pre-build;
citations resolve in [`FACTS.md`](../FACTS.md), [`DECISIONS.md`](../DECISIONS.md), and
[`EVIDENCE.md`](../EVIDENCE.md).*

x402 turns HTTP 402 into a machine-native payment flow: a client requests a resource,
the server answers with payment terms, the client signs an authorization, and a
facilitator verifies and settles it on-chain. The buyer is software — an agent paying
per request with no account and no API key. Stellar fits this well: a settlement costs
the operator a measured 22 973 stroops ≈ 0.0023 XLM (F-069), USDC is a first-class
SEP-41 asset with 7-decimal base units (F-008, F-052), and Soroban's authorization
model lets the buyer sign exactly one bounded contract call — `transfer(from, to,
amount)` with a ledger-bounded expiry — rather than a whole transaction (F-033, F-034).

**walras** is an x402 facilitator for Stellar plus the piece the ecosystem lacks: a
native **Bazaar**. Any paid HTTP endpoint or MCP tool whose payment settles through
walras is automatically cataloged and searchable — settlement *is* registration, a
deliberate anti-spam policy documented as policy, not spec conformance (F-023, D-004).
The facilitator is non-custodial by verified construction: it may not be the payer, the
source, or an auth participant in any payment it settles (F-035), and network fees are
sponsored so buyers hold only the payment asset (F-006).

What is demonstrated, all live on `stellar:testnet` and transcribed in EVIDENCE: an
unmodified stock x402 client completing 402 → sign → verify → settle through walras
with the transaction verifiable on-chain (F-066, S2-2); the protocol repository's own
e2e suite passing 4/4 against walras (F-067, S2-4); automatic cataloging with hostile
payloads soft-dropped by machine-readable reason while their settlements succeeded
(F-075, S3-4) — including a *real settled payment* that could not overwrite another
seller's listing (D-024); ranked natural-language search with a published evaluation
harness (recall@5 0.93, MRR@10 0.91 on a 28-query labeled set, S4-3) and honest
`partialResults` + cursor pagination that no reference operator implements (F-013,
D-003); and a generic MCP client completing discover→pay using only two tools —
`search_resources` and `paid_call` — including paying a live MCP tool that its own
settlement then cataloged (S6-3). Every rejection on every path carries a stable
machine code and a non-null human reason (D-007, D-028).

The design paper also states what does not exist yet, plainly: the system is
unaudited; every proof is testnet; search is a labeled lexical baseline; the `upto`
scheme for Stellar is a design (SEP-41 allowances alone cannot bind a recipient or
enforce single settlement — a contract-backed scheme is proposed, with the
contract-free variant documented as a weaker trust model); and caller authentication,
rate limiting, and catalog retention are planned operator-configurable surface. There
is no token.

Apache-2.0, with a copyleft-free shipped dependency path enforced in CI (F-060,
D-031). The hosted instance is operated by us; the decentralization claim is that
anyone can leave it — the same code self-hosts with one required secret
([runbook](../runbook.md)).
