#!/usr/bin/env node
/**
 * Dependency license scan — gate G-LIC.
 *
 * RFP 3.6 excludes strong copyleft from the deliverable's dependency tree; FACTS F-015
 * records that the OpenZeppelin Relayer path is AGPL and therefore unusable. This script
 * re-runs the Session 0 scan (EVIDENCE S0-5) against the real repository tree rather than
 * a throwaway probe directory, so the gate is repeatable in CI.
 *
 * Walks every package manifest under `node_modules/.pnpm`, buckets declared licenses, and
 * exits non-zero if anything lands in the forbidden or review sets, or declares nothing.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM_STORE = join(REPO_ROOT, "node_modules", ".pnpm");

/** Strong copyleft / network copyleft — a hard fail for this project. */
const FORBIDDEN = /\b(AGPL|SSPL|OSL|EUPL|CPAL|RPL)\b/i;
/** Weak or file-level copyleft — not automatically disqualifying, but must be looked at. */
const REVIEW = /\b(GPL|LGPL|MPL|CDDL|EPL)\b/i;

if (!existsSync(PNPM_STORE)) {
  console.error(`G-LIC FAIL — ${PNPM_STORE} not found. Run 'pnpm install' first.`);
  process.exit(1);
}

/**
 * Reads the declared license from a package manifest.
 *
 * @param manifestPath - Absolute path to a package.json.
 * @returns The declared license string, or null when the manifest declares none.
 */
function readLicense(manifestPath) {
  try {
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof pkg.license === "string") return pkg.license;
    if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
    if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
      return pkg.licenses.map(l => (typeof l === "string" ? l : l.type)).join(" OR ");
    }
    return null;
  } catch {
    return null;
  }
}

/** name@version → declared license (or null). */
const packages = new Map();

for (const storeEntry of readdirSync(PNPM_STORE)) {
  const modules = join(PNPM_STORE, storeEntry, "node_modules");
  if (!existsSync(modules)) continue;

  for (const entry of readdirSync(modules)) {
    const candidates = entry.startsWith("@")
      ? readdirSync(join(modules, entry)).map(scoped => `${entry}/${scoped}`)
      : [entry];

    for (const name of candidates) {
      const dir = join(modules, name);
      if (!statSync(dir).isDirectory()) continue;
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;

      let version = "unknown";
      try {
        version = JSON.parse(readFileSync(manifest, "utf8")).version ?? "unknown";
      } catch {
        /* fall through with the license read below */
      }
      packages.set(`${name}@${version}`, readLicense(manifest));
    }
  }
}

const histogram = new Map();
const forbidden = [];
const review = [];
const undeclared = [];

for (const [id, license] of [...packages].sort()) {
  if (license === null) {
    undeclared.push(id);
    continue;
  }
  histogram.set(license, (histogram.get(license) ?? 0) + 1);
  if (FORBIDDEN.test(license)) forbidden.push(`${id}  ${license}`);
  else if (REVIEW.test(license)) review.push(`${id}  ${license}`);
}

console.log("=== G-LIC dependency license scan ===");
console.log(`total distinct packages: ${packages.size}`);
console.log("\n--- license histogram ---");
for (const [license, count] of [...histogram].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4)} ${license}`);
}

console.log("\n--- FORBIDDEN (AGPL/SSPL/OSL/EUPL/CPAL/RPL) ---");
console.log(forbidden.length === 0 ? "  none" : forbidden.map(l => `  ${l}`).join("\n"));

console.log("\n--- REVIEW (GPL/LGPL/MPL/CDDL/EPL family) ---");
console.log(review.length === 0 ? "  none" : review.map(l => `  ${l}`).join("\n"));

console.log("\n--- UNKNOWN / undeclared ---");
console.log(undeclared.length === 0 ? "  none" : undeclared.map(l => `  ${l}`).join("\n"));

console.log("\n--- direct @x402/* and @stellar/* ---");
for (const [id, license] of [...packages].sort()) {
  if (id.startsWith("@x402/") || id.startsWith("@stellar/")) {
    console.log(`  ${id.padEnd(32)} ${license}`);
  }
}

const failures = forbidden.length + review.length + undeclared.length;
console.log(
  `\nGATE G-LIC: ${failures === 0 ? "PASS — no copyleft or undeclared licenses in tree" : "FAIL"}`,
);
process.exit(failures === 0 ? 0 : 1);
