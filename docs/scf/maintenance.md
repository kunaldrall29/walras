# Maintenance and spec tracking

The x402 discovery conventions are still moving, so our maintenance answer is a
process already in place, not a promise of attention.

Every protocol claim traces to a pinned spec commit (x402-foundation/x402 at SHA
17fc9890ade45a570a019352a3573391ad5d1e1f) through a fact ledger: nothing is
asserted anywhere in the repository without a verified row naming its source and
date (docs/FACTS.md), and divergence handling has its own log (docs/DECISIONS.md).

Drift breaks the build before it degrades behavior: a test greps the installed
upstream bundle for its reason-code literals, so an upstream rename fails CI
instead of silently weakening a rejection reason (docs/FACTS.md row F-063).

Upstream divergences are reported, not papered over — four are recorded already:
a spec/SDK type conflict (D-002), a reference-catalog keying bug (D-009), and two
end-to-end harness defects (D-019, D-020).

Through the grant period we commit, as cadence rather than calendar: re-verify
the fact ledger against each new spec commit we adopt; re-run the x402
repository's own end-to-end suite before each release; and gate every
search-ranking change on the evaluation harness's numbers (EVIDENCE S4-3 records
the baseline) rather than on eyeballed results.
