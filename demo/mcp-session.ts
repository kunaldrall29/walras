/**
 * MCP client session — Session 6 acceptance case: an agent completes
 * discover→pay using ONLY MCP tools.
 *
 * ZERO pre-baked integration: this file imports nothing from walras and
 * nothing from @x402/*. It is a generic MCP client that spawns the walras
 * MCP server over stdio, learns the two tools from tools/list, and drives
 * the whole flow from the JSON the tools return — ids, input examples,
 * receipts. Every request and result is printed verbatim: this output IS
 * the transcript for EVIDENCE S6.
 *
 * Flow (assertions inline; any failure exits non-zero):
 *  1. tools/list                                → the agent's entire knowledge
 *  2. search_resources "current weather …"      → ranked listings with ids
 *  3. paid_call { resourceId } (http listing)   → result + on-chain receipt
 *  4. paid_call { resourceId: garbage }         → walras_mcp_unknown_resource_id
 *  5. search_resources { cursor: garbage }      → walras_invalid_search_cursor
 *                                                 (facilitator code passthrough)
 *  6. paid_call { url, toolName }               → pays an MCP TOOL; this very
 *                                                 settlement auto-catalogs it
 *  7. search_resources "grandiloquent …"        → the tool is now listed (mcp)
 *  8. paid_call { resourceId } (mcp listing)    → pays it again by id
 *  9. Horizon: every receipt hash is a real, successful testnet transaction
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = new URL("..", import.meta.url).pathname;
const HORIZON = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const MCP_SELLER_URL = process.env.MCP_SELLER_URL ?? "http://127.0.0.1:4023/mcp";
const QUERY = process.env.MCP_DEMO_QUERY ?? "current weather in Zurich";

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

const transcript: Array<{ step: string; request: unknown; result: unknown }> = [];

async function call(
  client: Client,
  step: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ raw: ToolResult; body: Record<string, unknown> }> {
  console.log(`\n== ${step} ==`);
  console.log(`-> tools/call ${name} ${JSON.stringify(args)}`);
  const raw = (await client.callTool({ name, arguments: args })) as unknown as ToolResult;
  const text = firstText(raw);
  console.log(`<- isError=${raw.isError === true} ${text}`);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    check(false, `${step}: result text is JSON`);
  }
  transcript.push({ step, request: { name, args }, result: body });
  return { raw, body };
}

// --- 0. spawn the walras MCP server over stdio -----------------------------
const transport = new StdioClientTransport({
  command: "node",
  args: ["packages/mcp-server/dist/index.js"],
  cwd: ROOT,
  env: { ...process.env } as Record<string, string>,
  stderr: "pipe",
});
const client = new Client({ name: "s6-demo-agent", version: "0.1.0" });
await client.connect(transport);
transport.stderr?.on("data", (chunk: Buffer) => {
  process.stdout.write(`   [server stderr] ${chunk.toString()}`);
});

// --- 1. the agent's entire knowledge: tools/list ---------------------------
console.log("== 1. tools/list — everything the agent knows ==");
const { tools } = await client.listTools();
for (const tool of tools) {
  console.log(`  tool: ${tool.name}`);
  console.log(`    ${(tool.description ?? "").split("\n").join("\n    ")}`);
}
check(tools.length === 2, "exactly two tools exposed");
check(
  tools.map(t => t.name).sort().join(",") === "paid_call,search_resources",
  "tools are search_resources and paid_call",
);

// --- 2. search ------------------------------------------------------------
const search = await call(client, "2. search_resources", "search_resources", {
  query: QUERY,
  filters: { network: "stellar:testnet", limit: 5 },
});
const resources = (search.body.resources ?? []) as Array<Record<string, unknown>>;
check((search.body.count as number) > 0, "search returned results");
const pick = resources.find(r => r.type === "http");
check(pick !== undefined, "an http-typed listing is present");
if (pick === undefined) process.exit(1);
console.log(`  picked: ${pick.name} ${pick.resource} (id ${String(pick.id).slice(0, 24)}…)`);
const pickInput = (pick.input as { example?: Record<string, unknown> }).example;

// --- 3. pay the top hit by resourceId --------------------------------------
const paid1 = await call(client, "3. paid_call by resourceId (http)", "paid_call", {
  resourceId: pick.id,
  ...(pickInput !== undefined ? { input: pickInput } : {}),
});
check(paid1.raw.isError !== true, "paid_call succeeded");
check(paid1.body.paid === true, "payment was made");
const receipt1 = paid1.body.receipt as { transaction?: string; network?: string } | null;
check(/^[0-9a-f]{64}$/.test(receipt1?.transaction ?? ""), "receipt has a 64-hex tx hash");
check(receipt1?.network === "stellar:testnet", "receipt network is stellar:testnet");

// --- 4. structured error: unknown resourceId -------------------------------
const bad = await call(client, "4. paid_call with a bogus resourceId", "paid_call", {
  resourceId: "wr1:bm90LWEtcmVhbC1pZA",
});
check(bad.raw.isError === true, "bogus id is an error result");
check(bad.body.errorCode === "walras_mcp_unknown_resource_id", "errorCode is machine-readable");
check(typeof bad.body.reason === "string" && (bad.body.reason as string).length > 0, "reason is non-null");

// --- 5. structured error: facilitator code passthrough ---------------------
const badCursor = await call(client, "5. search_resources with a forged cursor", "search_resources", {
  query: "weather",
  filters: { cursor: "AAAA-not-a-cursor" },
});
check(badCursor.raw.isError === true, "forged cursor is an error result");
check(
  badCursor.body.errorCode === "walras_invalid_search_cursor",
  "facilitator's own code passes through verbatim",
);

// --- 6. pay an MCP TOOL by url+toolName; settling auto-catalogs it ---------
const paid2 = await call(client, "6. paid_call by url+toolName (mcp tool)", "paid_call", {
  url: MCP_SELLER_URL,
  toolName: "grandiloquate",
  input: { phrase: "hello friend" },
});
check(paid2.raw.isError !== true, "mcp tool paid_call succeeded");
check(paid2.body.paid === true, "mcp tool payment was made");
const receipt2 = paid2.body.receipt as { transaction?: string } | null;
check(/^[0-9a-f]{64}$/.test(receipt2?.transaction ?? ""), "mcp receipt has a 64-hex tx hash");
const result2 = paid2.body.result as { grandiloquent?: string };
check(
  result2?.grandiloquent === "Salutations most esteemed companion",
  "tool result is the deterministic translation",
);

// --- 7. the tool is now discoverable — cataloged by that settlement --------
const search2 = await call(client, "7. search_resources finds the just-settled MCP tool", "search_resources", {
  query: "grandiloquent victorian translation",
  filters: { type: "mcp" },
});
const mcpListings = (search2.body.resources ?? []) as Array<Record<string, unknown>>;
const grand = mcpListings.find(r => r.toolName === "grandiloquate");
check(grand !== undefined, "the MCP tool appeared in the catalog (settle-gated, D-004)");
if (grand === undefined) process.exit(1);
check(grand.type === "mcp", "listing type is mcp");
console.log(`  cataloged: ${grand.name} ${grand.resource} tool=${grand.toolName}`);

// --- 8. pay the MCP tool again, this time by its minted id -----------------
const paid3 = await call(client, "8. paid_call by resourceId (mcp)", "paid_call", {
  resourceId: grand.id,
  input: { phrase: "good evening" },
});
check(paid3.raw.isError !== true, "mcp-by-id paid_call succeeded");
const receipt3 = paid3.body.receipt as { transaction?: string } | null;
check(/^[0-9a-f]{64}$/.test(receipt3?.transaction ?? ""), "third receipt has a 64-hex tx hash");
const result3 = paid3.body.result as { grandiloquent?: string };
check(
  result3?.grandiloquent === "Supremely agreeable twilight hour",
  "second tool result is the deterministic translation",
);

// --- 9. every receipt is a real, successful transaction on testnet ---------
console.log("\n== 9. Horizon verification of all three settlements ==");
const hashes = [receipt1?.transaction, receipt2?.transaction, receipt3?.transaction] as string[];
check(new Set(hashes).size === 3, "three distinct transaction hashes");
const horizonFacts: Array<Record<string, unknown>> = [];
for (const hash of hashes) {
  let tx: { successful?: boolean; ledger?: number; fee_charged?: string } | null = null;
  for (let attempt = 0; attempt < 5 && tx === null; attempt += 1) {
    const response = await fetch(`${HORIZON}/transactions/${hash}`);
    if (response.status === 200) {
      tx = (await response.json()) as typeof tx;
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
  `\nMCP-SESSION-REPORT ${JSON.stringify({
    query: QUERY,
    httpPaid: receipt1?.transaction,
    mcpPaidByUrl: receipt2?.transaction,
    mcpPaidById: receipt3?.transaction,
    horizon: horizonFacts,
    failures,
  })}`,
);

if (failures > 0) {
  console.error(`mcp-session: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("mcp-session: PASS — discover→pay completed using ONLY MCP tools");
