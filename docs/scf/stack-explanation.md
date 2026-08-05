# Technical stack, in plain English

walras is a TypeScript service on Node.js 22 or later. The HTTP surface is
Fastify, exposing the x402 facilitator endpoints (verify, settle, supported) and
the two Bazaar discovery endpoints (catalog listing and ranked search).

Payment verification and settlement are not reimplemented: walras wraps the
Apache-2.0 `@x402/stellar` package, which validates Soroban authorization entries
and submits the token transfer on Stellar, and adds zero payment validation of
its own (docs/FACTS.md rows F-044, F-045). Network fees are sponsored by the
facilitator's submitter account, so a buyer needs only the payment asset (F-006).

The discovery catalog is SQLite through Node's built-in `node:sqlite` module —
zero added database dependencies (docs/DECISIONS.md entry D-023) — with SQLite's
FTS5 full-text index and BM25 ranking behind a one-method retriever seam, so
ranking can improve without touching the wire contract (D-026).

An MCP (Model Context Protocol) server exposes the whole discover-then-pay loop
to agents as two tools, `search_resources` and `paid_call`, over stdio (F-080).

Version 1 ships no new Soroban smart contract: the audit surface is an off-chain
service and its cryptographic validation (docs/THREAT-MODEL.md section 4).
