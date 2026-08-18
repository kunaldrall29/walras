/**
 * Policywright × walras — the acceptance case: an agent with NO prior
 * integration discovers a REAL production tool and pays it, and that first
 * payment is what put the tool in the catalog.
 *
 * ZERO pre-baked integration: this file imports nothing from walras,
 * nothing from @x402/*, and nothing from policywright. It is a generic MCP
 * client that spawns the walras MCP server over stdio, learns the two tools
 * from tools/list, and drives the whole flow from the JSON the tools
 * return. Every request and result is printed verbatim — this output IS the
 * transcript for EVIDENCE S6.
 *
 * The agent's premise is the real Policywright use case: it just performed a
 * Soroban transaction (the inlined RECORDED_TX — a real claim+swap) and
 * wants the least-privilege smart-account authorization that permits exactly
 * that flow. It does not know Policywright exists; it searches for the
 * capability.
 *
 * Flow (assertions inline; any failure exits non-zero):
 *  1. tools/list                                → the agent's entire knowledge
 *  2. search_resources "<capability query>"     → the tool is NOT there yet;
 *                                                 the catalog is settle-gated,
 *                                                 so nothing lists a tool no
 *                                                 one has paid (pay-to-list)
 *  3. paid_call { url, toolName, input }         → pays the Policywright tool;
 *                                                 the result is a synthesized
 *                                                 spec + an on-chain receipt,
 *                                                 and this settlement catalogs
 *                                                 the tool
 *  4. search_resources "<capability query>"     → the tool now appears (mcp),
 *                                                 listed by its first payment
 *  5. paid_call { resourceId, input }            → pays it again by minted id;
 *                                                 identical input ⇒ identical
 *                                                 synthesized bytes
 *  6. Horizon: both receipts are real, successful testnet transactions
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = new URL("..", import.meta.url).pathname;
const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const PW_MCP_URL = process.env.PW_MCP_URL ?? "http://127.0.0.1:4024/mcp";
const TOOL_NAME = process.env.PW_TOOL_NAME ?? "synthesize";
const QUERY =
  process.env.PW_DEMO_QUERY ??
  "least-privilege authorization for a smart account from a Soroban transaction";

/**
 * A real transaction the agent already performed: a Soroswap claim+swap.
 * This is the Policywright input — the thing a user did that they now want a
 * scoped, least-privilege smart-account policy for. Verbatim from the
 * policywright repo fixture examples/live/recorded-claim-swap.json.
 */
const RECORDED_TX = {
  hash: "2dcff6618ff12fb629700cab627b3870afa3f0dd000becf88b2eb7826d0b2c1b",
  network: "testnet",
  source: "rpc",
  ledger: 3817770,
  timestamp: 1785107316,
  subject: "CCW6R5ZKEIJJ75YT54TEHMRUYTP4XQGUI6H63EE3W65H4P4FAUICXP3Q",
  calls: [
    {
      contract: "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
      fnName: "swap_exact_tokens_for_tokens",
      args: [
        "10000000",
        "293170",
        [
          "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          "CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F",
        ],
        "CCW6R5ZKEIJJ75YT54TEHMRUYTP4XQGUI6H63EE3W65H4P4FAUICXP3Q",
        "1785107613",
      ],
      sourceHash: "2dcff6618ff12fb629700cab627b3870afa3f0dd000becf88b2eb7826d0b2c1b",
      authorizations: [
        {
          contract: "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
          fnName: "swap_exact_tokens_for_tokens",
          args: [
            "10000000",
            "293170",
            [
              "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
              "CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F",
            ],
            "CCW6R5ZKEIJJ75YT54TEHMRUYTP4XQGUI6H63EE3W65H4P4FAUICXP3Q",
            "1785107613",
          ],
          subInvocations: [
            {
              contract: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
              fnName: "transfer",
              args: [
                "CCW6R5ZKEIJJ75YT54TEHMRUYTP4XQGUI6H63EE3W65H4P4FAUICXP3Q",
                "CDVAIOYHCD4RUSLQNVFI7RIZBFT2JZMJWM4RTOLQZQXL4QAVXU5RFKDB",
                "10000000",
              ],
              subInvocations: [],
            },
          ],
        },
        {
          contract: "CCW6R5ZKEIJJ75YT54TEHMRUYTP4XQGUI6H63EE3W65H4P4FAUICXP3Q",
          fnName: "__check_auth",
          args: ["hex:daf0df5de450c59f2d49042d17eb7a14fa465073a4fc3ae08e0bbfec0cb3485a"],
          subInvocations: [],
        },
      ],
    },
    {
      contract: "CCSLYYVQ575EAPCDOEYGVOI4NVYD2V7RP3F5HRP4LVDUWEJ4HOLVL357",
      fnName: "harvest",
      args: ["GCH2MMBNWHJZUA3ZI5BTFDTJZQWALDOCRYXCT4S7MSN6RUXXA34E7B5G"],
      sourceHash: "acf256a0688e7f9c36520f4fc20cfa924d1b2e593033d85b0e443ce770b2d452",
      authorizations: [
        {
          contract: "CCSLYYVQ575EAPCDOEYGVOI4NVYD2V7RP3F5HRP4LVDUWEJ4HOLVL357",
          fnName: "harvest",
          args: ["GCH2MMBNWHJZUA3ZI5BTFDTJZQWALDOCRYXCT4S7MSN6RUXXA34E7B5G"],
          subInvocations: [],
        },
      ],
    },
  ],
  flows: [
    {
      asset: {
        contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
        symbol: "native",
        decimals: 7,
        resolved: true,
      },
      direction: "out",
      amount: "10000000",
    },
    {
      asset: {
        contractId: "CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F",
        symbol: "USDC",
        decimals: 7,
        resolved: true,
      },
      direction: "in",
      amount: "308600",
    },
  ],
  warnings: [],
};

let failures = 0;
function check(condition: unknown, label: string): void {
  if (condition) {
    console.log(`  ASSERT ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  ASSERT FAIL  ${label}`);
  }
}

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function firstText(result: ToolResult): string {
  const item = result.content.find(c => c.type === "text");
  return item?.text ?? "";
}

async function call(
  client: Client,
  step: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ raw: ToolResult; body: Record<string, unknown> }> {
  console.log(`\n== ${step} ==`);
  const argsForLog = JSON.stringify(args).slice(0, 200);
  console.log(`-> tools/call ${name} ${argsForLog}${argsForLog.length >= 200 ? "…" : ""}`);
  const raw = (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
  const text = firstText(raw);
  console.log(`<- isError=${raw.isError === true} ${text.slice(0, 600)}${text.length > 600 ? "…" : ""}`);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    check(false, `${step}: result text is JSON`);
  }
  return { raw, body };
}

function listedTool(
  body: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const resources = (body.resources ?? []) as Array<Record<string, unknown>>;
  return resources.find(r => r.toolName === TOOL_NAME && r.type === "mcp");
}

// --- 0. spawn the walras MCP server over stdio -----------------------------
const transport = new StdioClientTransport({
  command: "node",
  args: ["packages/mcp-server/dist/index.js"],
  cwd: ROOT,
  env: { ...process.env } as Record<string, string>,
  stderr: "pipe",
});
const client = new Client({ name: "policywright-demo-agent", version: "0.1.0" });
await client.connect(transport);
transport.stderr?.on("data", (chunk: Buffer) => {
  process.stdout.write(`   [server stderr] ${chunk.toString()}`);
});

// --- 1. the agent's entire knowledge: tools/list ---------------------------
console.log("== 1. tools/list — everything the agent knows ==");
const { tools } = await client.listTools();
for (const tool of tools) console.log(`  tool: ${tool.name}`);
check(
  tools.map(t => t.name).sort().join(",") === "paid_call,search_resources",
  "exactly two tools: search_resources and paid_call",
);

// --- 2. search BEFORE any payment — the tool is not there yet ---------------
const before = await call(client, "2. search_resources (before payment)", "search_resources", {
  query: QUERY,
  filters: { type: "mcp", limit: 10 },
});
check(listedTool(before.body) === undefined, "the tool is NOT listed before anyone pays it");
console.log(
  "  pay-to-list: the catalog is settle-gated (DECISIONS D-004) — a tool nobody has\n" +
    "  paid is a tool nobody can list. The agent must pay it to make it exist here.",
);

// --- 3. pay the Policywright tool by url+toolName; settling catalogs it -----
const paid1 = await call(client, "3. paid_call by url+toolName (Policywright synthesize)", "paid_call", {
  url: PW_MCP_URL,
  toolName: TOOL_NAME,
  input: { recordedTx: RECORDED_TX },
});
check(paid1.raw.isError !== true, "paid_call succeeded");
check(paid1.body.paid === true, "a payment was made");
const receipt1 = paid1.body.receipt as { transaction?: string; network?: string; amount?: string } | null;
check(/^[0-9a-f]{64}$/.test(receipt1?.transaction ?? ""), "receipt has a 64-hex tx hash");
check(receipt1?.network === "stellar:testnet", "receipt network is stellar:testnet");
const result1 = paid1.body.result as Record<string, unknown> | undefined;
const spec1 = result1?.spec as { contextRule?: { scopedCalls?: unknown[] }; policies?: unknown[] } | undefined;
check(Array.isArray(spec1?.contextRule?.scopedCalls), "the result is a synthesized SmartAccountSpec");
check(
  (spec1?.contextRule?.scopedCalls?.length ?? 0) === 2,
  "the rule scopes exactly the two contract calls the agent performed",
);
if (receipt1?.transaction) {
  console.log(`  RECEIPT  tx ${receipt1.transaction}`);
  console.log(`  LEDGER   https://stellar.expert/explorer/testnet/tx/${receipt1.transaction}`);
}
if (spec1) {
  console.log(
    `  SYNTHESIZED  rule "${(spec1 as { contextRule?: { name?: string } }).contextRule?.name}", ` +
      `${spec1.policies?.length ?? 0} policies, scope=${spec1.contextRule?.scopedCalls
        ?.map(c => (c as { fnName?: string }).fnName)
        .join(" + ")}`,
  );
}

// --- 4. search AFTER payment — the tool is now in the catalog --------------
const after = await call(client, "4. search_resources (after payment)", "search_resources", {
  query: QUERY,
  filters: { type: "mcp", limit: 10 },
});
const listing = listedTool(after.body);
check(listing !== undefined, "the tool now appears — cataloged by its first payment (settle-gated)");
if (listing === undefined) {
  console.error("policywright-session: the tool was not cataloged; cannot continue");
  process.exit(1);
}
check(listing.type === "mcp", "listing type is mcp");
check(listing.resource === PW_MCP_URL, "listing url is the tool's real streamable-HTTP endpoint");
console.log(`  CATALOG  ${listing.name} — ${listing.resource} tool=${listing.toolName}`);
console.log(`           price ${JSON.stringify(listing.price)} · id ${String(listing.id).slice(0, 28)}…`);
const paramDesc = JSON.stringify(listing.input ?? {}).slice(0, 240);
console.log(`           input: ${paramDesc}…`);

// --- 5. pay it again by minted id; determinism holds -----------------------
const paid2 = await call(client, "5. paid_call by resourceId (the minted mcp id)", "paid_call", {
  resourceId: listing.id,
  input: { recordedTx: RECORDED_TX },
});
check(paid2.raw.isError !== true, "second paid_call succeeded");
const receipt2 = paid2.body.receipt as { transaction?: string } | null;
check(/^[0-9a-f]{64}$/.test(receipt2?.transaction ?? ""), "second receipt has a 64-hex tx hash");
const result2 = paid2.body.result as Record<string, unknown> | undefined;
check(
  JSON.stringify(result2?.spec) === JSON.stringify(result1?.spec),
  "identical input ⇒ identical synthesized spec (deterministic tool)",
);

// --- 6. both receipts are real, successful transactions on testnet ---------
console.log("\n== 6. Horizon verification of both settlements ==");
const hashes = [receipt1?.transaction, receipt2?.transaction] as string[];
check(new Set(hashes).size === 2, "two distinct transaction hashes");
type HorizonTx = { successful?: boolean; ledger?: number; fee_charged?: string };
const horizonFacts: Array<Record<string, unknown>> = [];
for (const hash of hashes) {
  let tx: HorizonTx | null = null;
  for (let attempt = 0; attempt < 6 && tx === null; attempt += 1) {
    const response = await fetch(`${HORIZON}/transactions/${hash}`);
    if (response.status === 200) {
      tx = (await response.json()) as HorizonTx;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  check(tx?.successful === true, `tx ${hash.slice(0, 8)}… is on-chain and successful`);
  console.log(
    `  ${hash} ledger=${tx?.ledger} fee=${tx?.fee_charged} stroops ` +
      `https://stellar.expert/explorer/testnet/tx/${hash}`,
  );
  horizonFacts.push({ hash, ledger: tx?.ledger, feeStroops: tx?.fee_charged });
}

await client.close();

console.log(
  `\nPOLICYWRIGHT-SESSION-REPORT ${JSON.stringify({
    query: QUERY,
    tool: TOOL_NAME,
    firstPaid: receipt1?.transaction,
    secondPaidById: receipt2?.transaction,
    catalogedByFirstPayment: true,
    horizon: horizonFacts,
    failures,
  })}`,
);

if (failures > 0) {
  console.error(`policywright-session: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log(
  "policywright-session: PASS — a real production MCP tool, discovered and paid by an\n" +
    "agent with zero prior integration, cataloged by its own first payment.",
);
