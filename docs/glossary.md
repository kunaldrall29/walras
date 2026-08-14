# Glossary

Every term cites the FACTS row, DECISIONS entry, or pinned spec location that
defines it. Pinned spec commit:
`x402-foundation/x402 @ 17fc9890ade45a570a019352a3573391ad5d1e1f` (the FACTS.md
header; section references below are at that SHA).

## Protocol roles

- **facilitator** — the service that verifies and settles payments on behalf of
  resource servers; serves `POST /verify`, `POST /settle`, `GET /supported`
  (x402 v2 spec §7.1–§7.3 @ 17fc9890; F-040). walras is one.
- **resource server / seller** — the HTTP or MCP server that charges for a
  resource: it answers 402 with payment terms and forwards the buyer's payload
  to the facilitator for verification and settlement (x402 v2 spec @ 17fc9890;
  the stock middleware path is F-074).
- **buyer / agent** — the paying client. An *agent* is a buyer that discovers
  resources through the catalog first and then pays, human out of the loop
  (x402 v2 spec @ 17fc9890; the Bazaar extension exists for exactly this
  consumer, F-009).
- **submitter** — walras's name for the account(s) that source settlement
  transactions and sponsor their network fees (F-006). `SUBMITTER_SECRET`
  accepts a comma-separated list for round-robin selection (D-012).
- **non-custodial** — the facilitator is never the payer: the scheme rejects any
  payload where a facilitator address is the transaction source, operation
  source, `from`, or an auth-entry participant (F-035), and the receipt's
  `payer` is always the client's address, never the facilitator's (F-038).

## Payment mechanics

- **exact scheme** — the payment scheme walras serves: the payload is exactly
  `{"transaction": "<base64 XDR>"}`, one `invokeHostFunction` operation calling
  `transfer(from, to, amount)` on a SEP-41 token, plus signed auth entries
  (F-033).
- **upto scheme** — a variable-amount scheme; at the pinned SHA only EVM and SVM
  variants exist and there is no Stellar `upto` (F-005). Design work for a
  Stellar variant is planned.
- **auth entry** — the Soroban authorization entry in which the buyer signs
  approval for exactly `transfer(from, to, amount)` on one asset contract
  (F-033). What the buyer signs is this entry, not a whole transaction.
- **signatureExpirationLedger / ledger-bounded expiry** — an auth entry is valid
  until a ledger number, not a wall-clock time:
  `ceil(maxTimeoutSeconds / estimatedLedgerSeconds)` ledgers ahead, which is
  ~12 ledgers ≈ 60 s at the spec's illustrative 60 s timeout (F-034).
- **fee-bump transaction** — a Stellar transaction wrapping another so a
  separate account pays the fee; `FEE_BUMP_SECRET` enables it, decoupling fee
  payment from sequence numbers (F-047). The reference operator settles this
  way in production (F-055).
- **sponsored fees / `areFeesSponsored`** — the facilitator's submitter pays the
  network fee, so the buyer needs only the payment asset (F-006). Advertised
  per-kind in `/supported` as `extra.areFeesSponsored: true` (F-041).
- **PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE** — the canonical
  x402 v2 wire headers between buyer and seller: terms, paid request, receipt
  (F-065). `X-PAYMENT` / `X-PAYMENT-RESPONSE` are the v1 names only (F-065).

## Stellar

- **Soroban** — Stellar's smart-contract platform. The exact scheme moves
  Soroban tokens and simulates every payload against a Soroban RPC (F-033,
  F-004).
- **SEP-41** — the Stellar token interface the scheme pays: SEP-41 Soroban
  tokens only, classic assets are not supported (F-033). USDC, 7 decimals,
  amounts in base units, is the default asset (F-008).
- **Stellar Asset Contract (SAC)** — the Soroban contract wrapping a classic
  asset. Testnet USDC's SAC is
  `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`, verified four
  independent ways (F-052).
- **trustline** — a classic-Stellar account's opt-in to hold an asset; the
  seller and buyer accounts need a USDC trustline (F-056). Each trustline raises
  the account's minimum balance by one base reserve of 0.5 XLM — invisible on
  testnet, real on pubnet (F-085).
- **stroop** — the smallest XLM unit: 22 973 stroops = 0.0022973 XLM, the
  measured walras settlement fee on the single-submitter path (F-069); the
  fee-bump path measures 23 073 stroops (F-086).
- **CAIP-2** — the chain-id convention behind network names: `stellar:testnet`,
  `stellar:pubnet` (custom RPC URL required), `stellar:*` wildcard (F-004).
- **Friendbot** — the testnet XLM faucet; `scripts/setup-accounts.mjs` funds all
  three quickstart accounts through it (F-056).
- **Circle faucet** — faucet.circle.com, the captcha-gated source of testnet
  USDC (select Stellar); the one quickstart step that needs a human (F-056).

## Discovery

- **Bazaar** — the discovery layer: an official x402 v2 extension in the
  reference SDK (F-009). walras serves it as `GET /discovery/resources` and
  `GET /discovery/search`.
- **discovery extension** — the `bazaar` block a seller declares in its 402 and
  the client echoes into the payment payload; if the client omits the echo, no
  cataloging occurs (F-032). Storage and exposure are facilitator
  implementation details (F-023).
- **settle-gated cataloging** — a listing exists only because a payment settled
  on-chain through walras; deliberate anti-spam policy, not spec conformance
  (D-004).
- **soft drop** — discarding an invalid *optional field* (`serviceName`, `tags`,
  `iconUrl`, `routeTemplate`) while keeping the listing and the settlement
  (F-030, F-031). Distinct from a `rejected` catalog write, which refuses the
  whole listing with a machine code while the settlement still succeeds (D-025).
- **routeTemplate** — the seller-declared path template that canonicalizes a
  listing URL; validated (percent-decoding before the `..` / `://` checks),
  falling back to the concrete path on failure (F-030).
- **EXTENSION-RESPONSES** — the base64-encoded JSON header, keyed by extension
  name, that reports cataloging outcomes on a settle response (F-024). walras
  adds an additive machine `code` beside the spec's human `rejectedReason`
  (D-014).

## Search and MCP

- **`partialResults`** — search-response flag, `true` exactly when matches were
  truncated from the response (F-028, D-027).
- **keyset cursor** — walras's search pagination token: base64url state binding
  position *and* query context, so a cursor replayed against a different query
  is a named 400 rather than a silently wrong page (D-027).
- **resourceId (`wr1:`)** — the MCP server's deterministic, self-describing
  listing id: `"wr1:" + base64url(JSON [type, resource, toolName])`, re-resolved
  against the live catalog before any payment (D-029).
- **MCP** — the Model Context Protocol. x402 defines an MCP transport at the
  pinned SHA (F-079); MCP listings are keyed on the (`url`, `toolName`) tuple
  because one endpoint multiplexes many tools (F-029).
