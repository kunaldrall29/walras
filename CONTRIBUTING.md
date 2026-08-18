# Contributing to walras

walras is an x402 facilitator for Stellar plus a Bazaar discovery catalog. It is
testnet software with an unusual documentation discipline; the section on FACTS
below is the part most contributors have not seen elsewhere — read it before your
first PR.

## Development workflow

Node ≥ 22 is required. pnpm comes via corepack (`corepack enable`); the
`packageManager` field in `package.json` pins the exact version.

```bash
pnpm install
pnpm build
pnpm test            # runs the single-SDK check first (D-013), then the workspace suites
pnpm typecheck
pnpm check:licenses  # gate G-LIC — the two-tier license gate (D-031)
```

`pnpm test` deliberately runs `scripts/check-single-stellar-sdk.mjs` before any
suite: two copies of `@stellar/stellar-sdk` in the tree produce XDR objects that
fail `instanceof` across package boundaries, which presents as nonsense type
errors rather than a version conflict ([`docs/DECISIONS.md`](./docs/DECISIONS.md)
D-013).

Before any PR that touches documentation:

```bash
pnpm docs:gen && pnpm docs:check
```

`docs:gen` regenerates every generated artifact; `docs:check` is a CI gate that
fails on generator drift, stale diagram SVGs, dead links, banned marketing words,
and uncited capability claims.

## Sign-off (DCO)

Every commit carries a `Signed-off-by` line — use `git commit -s`. Why: the
Developer Certificate of Origin gives a permissively licensed payment codebase a
provenance trail, so every line can be traced to someone who certified they had
the right to contribute it under Apache-2.0.

## The FACTS discipline

This is the heart of contributing here. The repository treats claims the way it
treats code: nothing lands unverified.

- **No protocol, library, or API claim** lands in code comments, docs, or PR text
  unless [`docs/FACTS.md`](./docs/FACTS.md) has a row for it with status
  **VERIFIED**, a **source**, and a **date**. If the row does not exist, add it —
  do not assert from memory.
- **Capability claims** ("this works", "this passes") require a [`docs/EVIDENCE.md`](./docs/EVIDENCE.md)
  transcript, and the claim must link it. Anything not yet evidenced is written
  as **planned**.
- **Divergences** — anywhere the spec, the SDK, the reference operator, or this
  repository disagree — get an entry in
  [`docs/DECISIONS.md`](./docs/DECISIONS.md) stating what walras does and why.
- **Generated docs are never edited by hand**: `docs/api/`, `docs/reference/`,
  and the catalog ERD are generator output. Edit the source (route schemas,
  `CONFIG_REFERENCE`, error enumerations, DDL) and run `pnpm docs:gen`;
  `docs:check` fails CI on drift.

**Adding a FACTS row:** write a one-sentence falsifiable claim, status
(VERIFIED), the date you verified it, and the source — a file and line at the
pinned spec SHA, a live capture, or a registry lookup. Spec citations reference
the pinned commit `x402-foundation/x402 @
17fc9890ade45a570a019352a3573391ad5d1e1f`; if upstream has moved, verify at the
pin first and record the drift in DECISIONS rather than silently re-pinning.

## PR expectations

- **Tests accompany behavior changes.** The suites are hermetic (no `.env`, no
  secrets, no network) — keep them that way.
- **`pnpm docs:check` is green**, including on PRs that "only" touch docs.
- **No new dependencies without a license-scan run.** Run `pnpm check:licenses`
  and read its output: the shipped path tolerates zero copyleft, and dev-toolchain
  exceptions require a reviewed, pinned entry in `scripts/license-scan.mjs`
  (D-031).
