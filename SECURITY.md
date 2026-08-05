# Security Policy — walras

## Reporting a vulnerability

Report privately by email to **kunaldrall29@gmail.com**. Do not open a public issue
for an undisclosed vulnerability. You will receive an acknowledgement within **7
days** of your report.

There is **no bug bounty** at this time. That is stated plainly so nobody invests
effort expecting one; reports are still wanted and will be credited if you ask.

## Status: testnet, unaudited

Everything this repository describes runs on `stellar:testnet`, and the code is
**unaudited**. A third-party security review via the Stellar Audit Bank is planned
before any mainnet production tag; the audit scope — an offchain service and its
cryptographic validation, no new Soroban contract in v1 — is stated in
[`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) §4.

## In scope

The threat inventory lives in [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md);
reports against any row there, or against a threat it misses, are in scope.
Specifically:

- **The facilitator payment surface** — `POST /verify`, `POST /settle`,
  `GET /supported`: the wrapper's envelope handling, kind routing, configuration,
  and error model. Payment validation itself is inherited from `@x402/stellar`
  (F-045) — a flaw there is upstream (see below), but a flaw in how walras wraps,
  configures, or reports it is ours.
- **The discovery/catalog trust boundary** — settle-gated indexing, listing
  ownership by verified `payTo` (D-024), and the soft-drop validation of
  client-echoed metadata (F-072).
- **The MCP server's payment policy** — the spend cap and its double enforcement,
  and resource-id resolution in `paid_call` (D-030).

## Out of scope

- Denial of service that is meaningful only on testnet.
- The documented spam-economics residual: `docs/THREAT-MODEL.md` §2 names index
  spam via micro-settlements as partially controlled — settle-gating prices every
  catalog write at a real settlement (D-004), and the remainder is disclosed there.
  A report that restates that residual is not a vulnerability; a report that
  *amplifies* it beyond what §2 states is welcome.
- Vulnerabilities in the upstream `@x402/*` or `@stellar/*` packages. Report those
  upstream to their maintainers; walras will coordinate on any wrapper-side
  mitigation, and inherited deviations are disclosed rather than hidden (D-008).
- The x402.org hosted facilitator. It is the ecosystem's conformance baseline, not
  ours — we do not operate it.

## Secrets hygiene for reporters

Never include a real secret seed (`S...`) in a report — not even a testnet seed you
consider disposable. Testnet **reproduction cases are welcome**: transcripts,
payment payloads, transaction hashes, and public addresses are all safe to send and
make reports far easier to act on.
