# walras.space — landing page

A single self-contained static page: `index.html`. Vanilla HTML/CSS/JS, no build
step, no framework, no runtime dependencies. The only external resources at
runtime are Google Fonts and (optionally) one facilitator liveness probe — see
the CONFIG contract below.

## Provenance

Implemented from the Claude Design project **"Walras.space site specification"**,
file **`Walras Landing v2.dc.html`**, imported 2026-08-14. The original export
(and its React-based `support.js` runtime, which is *not* shipped) is kept
under `design/` as the source of truth for the visual design. The `.dc.html`
template, its `DCLogic` terminal-animation state machine, and its pseudo-state
styles were translated by hand into the vanilla `index.html`; honesty
corrections (real facilitator port, real boot commands, fact-file-grounded
ledger captions) were applied on top — repo `docs/FACTS.md` wins over the
design's copy.

## CONFIG contract

All live values on the page come from the single `CONFIG` object at the top of
the inline script in `index.html`. Edit and reload — no rebuild. An empty
string (or `0` for `CATALOG_COUNT`) hides that segment entirely; no placeholder
text can ever render.

| Key | Effect |
| --- | --- |
| `FACILITATOR_URL` | Badge probe target (see rule below). |
| `TX_HASH_FULL` | Target of the ticker's "last settled" stellar.expert link. |
| `TX_HASH_SHORT` | Ticker "last settled" label and the terminal's `tx …` line. |
| `MEASURED_FEE_XLM` | Ticker "fee … XLM" segment and the Ledger measured-fee cell. |
| `CATALOG_COUNT` | Ticker "N listings" segment (only when > 0). |
| `CONTACT_EMAIL` | Footer mailto link (only when set). |

Badge rule: if `FACILITATOR_URL` is empty → badge
`'OPEN SOURCE · APACHE-2.0 · IN DEVELOPMENT'`, no network call at all. If set →
render IN DEVELOPMENT first, then `fetch(FACILITATOR_URL + '/supported', 5s timeout)`;
only a 200 response flips the badge text to `'… · STELLAR TESTNET'`. Any
failure leaves IN DEVELOPMENT. That probe is the only permitted non-font
network call on the page.

## Deploy

Manual. Nothing here deploys automatically; copy `index.html` to the host
serving walras.space when you decide to.
