# Infrastructure

Each facilitator instance is a single Node.js process plus one local SQLite file
for the catalog — no external database, no message queue, and no proprietary
cloud dependency anywhere in the codebase (docs/DECISIONS.md entry D-023). The
only credentials an instance holds are its own Stellar submitter seed(s),
supplied by environment variable.

Stellar access goes through the public Soroban RPC: `soroban-testnet.stellar.org`
is the package default for stellar:testnet, and a mainnet deployment requires the
operator to supply its own RPC URL (docs/FACTS.md row F-004). Every capability in
this submission was exercised on exactly this footprint — one process, one SQLite
file, public testnet RPC (EVIDENCE sections S2-2 through S6-3 in
docs/EVIDENCE.md).

The hosted instance's production infrastructure — hosting provider, monitoring
stack, and the mainnet RPC provider choice — is planned, not yet stood up; we
name that plainly rather than describe a stack we have not operated. Because the
footprint is one process and one file, the hosted and self-hosted paths deploy
the same artifact, and moving between them is an operational change, not a code
change.
