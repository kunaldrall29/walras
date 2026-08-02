#!/usr/bin/env node
/**
 * Asserts exactly one `@stellar/stellar-sdk` resolves in the dependency tree.
 *
 * DECISIONS D-013 / FACTS F-059: `@x402/stellar@2.20.0` requires `^16.0.1` and its settle
 * path is written against v16 fee semantics. A second copy in the tree produces XDR
 * objects that fail `instanceof` checks across the package boundary — a bug class that
 * presents as nonsense type errors at runtime rather than as a version conflict.
 *
 * Exits non-zero on more than one copy, so `pnpm test` fails before the tests run.
 */
import { readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM_STORE = join(REPO_ROOT, "node_modules", ".pnpm");
const PACKAGE = "@stellar+stellar-sdk@";

if (!existsSync(PNPM_STORE)) {
  console.error(`check:deps FAIL — ${PNPM_STORE} not found. Run 'pnpm install' first.`);
  process.exit(1);
}

const copies = readdirSync(PNPM_STORE)
  .filter(entry => entry.startsWith(PACKAGE))
  .map(entry => entry.slice(PACKAGE.length))
  .sort();

if (copies.length === 0) {
  console.error("check:deps FAIL — @stellar/stellar-sdk is not present in the tree.");
  process.exit(1);
}

if (copies.length > 1) {
  console.error(`check:deps FAIL — ${copies.length} copies of @stellar/stellar-sdk in the tree:`);
  for (const version of copies) console.error(`  - ${version}`);
  console.error("Pin every workspace package to the same ^16 range (DECISIONS D-013).");
  process.exit(1);
}

const [version] = copies;
if (!version.startsWith("16.")) {
  console.error(`check:deps FAIL — @stellar/stellar-sdk@${version}; D-013 requires ^16.`);
  process.exit(1);
}

console.log(`check:deps PASS — exactly one @stellar/stellar-sdk in the tree (${version})`);
