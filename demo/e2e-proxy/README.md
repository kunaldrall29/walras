# walras as an x402 e2e external facilitator

These four files expose the built, unmodified walras facilitator to the x402 repo's e2e
harness (`e2e/` at the pinned SHA). The harness's `external-proxies` directory is
gitignored upstream, so the canonical copy lives here.

Setup, from a clone of `x402-foundation/x402` with `e2e/` installed:

```bash
cp -r demo/e2e-proxy <x402>/e2e/facilitators/external-proxies/walras
```

`<x402>/e2e/.env` needs the three Stellar variables (FACTS F-056) plus structurally-valid
throwaway EVM/SVM keys — the stock e2e client and servers construct EVM/SVM signers
unconditionally at startup even for Stellar-only runs:

```
SERVER_STELLAR_ADDRESS=G...        # seller, holds a USDC trustline
CLIENT_STELLAR_PRIVATE_KEY=S...    # buyer, holds testnet USDC
FACILITATOR_STELLAR_PRIVATE_KEY=S... # walras submitter
CLIENT_EVM_PRIVATE_KEY=0x…  FACILITATOR_EVM_PRIVATE_KEY=0x…  SERVER_EVM_ADDRESS=0x…
CLIENT_SVM_PRIVATE_KEY=…    FACILITATOR_SVM_PRIVATE_KEY=…    SERVER_SVM_ADDRESS=…
```

Run:

```bash
cd <x402>/e2e
pnpm test --facilitators=walras --servers=express,hono --clients=fetch,axios \
          --families=stellar --testnet
```

Two harness caveats at the pinned SHA, both documented in DECISIONS D-019/D-020 and
EVIDENCE S2-4: the mock facilitator needs `"batch-settlement"` added to its `evmSchemes`
(one-line scaffolding fix, else every TS server's route validation rejects a
Stellar-only facilitator), and `servers/fastify` cannot run against single-family
facilitators at all (it never wires `MOCK_FACILITATOR_URL`) — exclude it.

Result of this exact setup on 2026-08-02: **4/4 scenarios passed**, each with a real
`stellar:testnet` settlement — EVIDENCE S2-4.
