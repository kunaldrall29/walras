# Decentralization

Our decentralization claim is the ability to exit the hosted operator, not the
absence of one — and we state that honestly. The hosted walras instance is
operated by us; nothing in the protocol or the code privileges it.

What makes exit real rather than nominal: the repository is Apache-2.0 with zero
copyleft anywhere on the shipped dependency path (docs/FACTS.md row F-060), so
anyone can run the identical code — clone the public repository, set one
environment variable, start. The self-host path is documented in the same public
repository, and a self-hosted instance catalogs whatever settles through it.
Settle-gated cataloging is a stated design choice, not a hidden lock-in
(docs/DECISIONS.md entry D-004).

There is no walled garden at the wire level. Interoperability rests on
conformance with the stock x402 SDK, not on any walras-specific client: an
unmodified stock client completed a payment end to end through walras on
stellar:testnet (EVIDENCE S2-2 in docs/EVIDENCE.md), and the x402 repository's
own end-to-end suite passed 4/4 against walras (EVIDENCE S2-4).

Today there is one hosted catalog; federation across independently operated
catalogs is planned, as interop direction rather than a delivered feature.
