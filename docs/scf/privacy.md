# Privacy and user protection

What the facilitator processes: payment payloads — a signed Stellar transaction
and its authorization entries — pass through verify and settle transiently and
are not persisted. walras keeps no settlement table; the on-chain transaction and
the receipt returned to the seller are the only records (docs/MODELS.md section
3).

What it stores: the Bazaar catalog holds only seller-declared discovery metadata
(name, description, tags, parameter schema), the payTo address verified by
settlement, and per-listing settlement timestamps and counts (docs/DECISIONS.md
entry D-024).

There are no user accounts, no API keys, no tracking cookies, and no analytics.
The buyer is software paying per request; walras never learns who operates it.
Server logs are operational — machine-readable reason codes, latencies, public
addresses — and never contain secret seeds (docs/THREAT-MODEL.md section 1). Log
retention is short and under the operator's control; the hosted instance will
publish its retention window.

One boundary users should understand: settlements are transactions on a public
blockchain. Payer address, payee address, asset, amount, and time are permanently
public on the Stellar ledger by the nature of the chain. walras adds no
off-chain record beyond the catalog fields above.
