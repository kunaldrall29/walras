#!/usr/bin/env node
/**
 * Dependency license scan — gate G-LIC.
 *
 * RFP 3.6 excludes strong copyleft from the deliverable's dependency tree; FACTS F-015
 * records that the OpenZeppelin Relayer path is AGPL and therefore unusable. This script
 * re-runs the Session 0 scan (EVIDENCE S0-5) against the real repository tree rather than
 * a throwaway probe directory, so the gate is repeatable in CI.
 *
 * Two tiers, per DECISIONS D-031:
 *
 *  1. The SHIPPED dependency path — every production dependency, transitively, of every
 *     workspace project (what a self-hoster runs as a network service and what the
 *     packages redistribute). Zero tolerance: strong copyleft, weak/file-level copyleft,
 *     and undeclared licenses all fail the gate here.
 *
 *  2. The DEV TOOLCHAIN — devDependency-only packages (build, test, docs rendering).
 *     Strong/network copyleft still fails outright. Weak-copyleft or undeclared entries
 *     must appear in `DEV_TOOLCHAIN_EXCEPTIONS` below with a written rationale, which is
 *     printed on every run — a silent allowlist would defeat the gate's purpose. An
 *     unlisted finding fails; a version bump of a listed one re-triggers review because
 *     entries pin name@version exactly.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PNPM_STORE = join(REPO_ROOT, "node_modules", ".pnpm");

/** Strong copyleft / network copyleft — a hard fail anywhere in the tree. */
const FORBIDDEN = /\b(AGPL|SSPL|OSL|EUPL|CPAL|RPL)\b/i;
/** Weak or file-level copyleft — fails the shipped path; reviewable in dev tooling. */
const REVIEW = /\b(GPL|LGPL|MPL|CDDL|EPL)\b/i;

/**
 * Reviewed dev-toolchain exceptions (DECISIONS D-031). Each entry pins an exact
 * name@version and records why it is acceptable OUTSIDE the shipped dependency path.
 * None of these packages is redistributed by walras or runs in the facilitator,
 * bazaar, mcp-server, or demo production dependency path — the scan below verifies
 * that claim on every run and fails if it stops being true.
 */
const DEV_TOOLCHAIN_EXCEPTIONS = new Map([
  [
    "elkjs@0.9.3",
    "EPL-2.0. Diagram layout engine inside @mermaid-js/mermaid-cli; executes only at docs " +
      "build time (pnpm docs:gen). EPL obligations attach to distribution of the covered " +
      "code, and walras does not redistribute it.",
  ],
  [
    "dompurify@3.4.13",
    "Dual-licensed 'MPL-2.0 OR Apache-2.0' — Apache-2.0 elected. Dev-only via mermaid.",
  ],
  [
    "khroma@2.1.0",
    "Manifest declares no license field, but the package ships a MIT license file " +
      "(verified on disk by this script on every run). Dev-only via mermaid.",
  ],
]);

/**
 * On-disk verification for exceptions whose manifest is silent: path fragments to a
 * license file inside the package dir, plus the text the file must contain.
 */
const EXCEPTION_LICENSE_FILE_CHECKS = new Map([
  ["khroma@2.1.0", { file: "license", mustContain: "MIT License" }],
]);

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

/**
 * Resolves the shipped dependency path: every production dependency, transitively, of
 * every workspace project, as `name@version` ids.
 *
 * @returns Set of shipped `name@version` ids.
 */
function shippedDependencyPath() {
  const result = spawnSync("pnpm", ["ls", "-r", "--prod", "--depth=Infinity", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error("G-LIC FAIL — could not resolve the production dependency path via pnpm ls.");
    console.error(result.stderr);
    process.exit(1);
  }
  const shipped = new Set();
  const walk = deps => {
    for (const [name, meta] of Object.entries(deps ?? {})) {
      const id = `${name}@${meta.version ?? "unknown"}`;
      if (shipped.has(id)) continue;
      shipped.add(id);
      walk(meta.dependencies);
    }
  };
  for (const project of JSON.parse(result.stdout)) walk(project.dependencies);
  return shipped;
}

/** name@version → { license, dir }. */
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
      packages.set(`${name}@${version}`, { license: readLicense(manifest), dir });
    }
  }
}

const shipped = shippedDependencyPath();

const histogram = new Map();
const forbidden = [];
const shippedViolations = [];
const devUnreviewed = [];
const devReviewed = [];

for (const [id, { license, dir }] of [...packages].sort()) {
  const inShippedPath = shipped.has(id);
  const finding =
    license === null
      ? "undeclared"
      : FORBIDDEN.test(license)
        ? "forbidden"
        : REVIEW.test(license)
          ? "review"
          : null;

  if (license !== null) histogram.set(license, (histogram.get(license) ?? 0) + 1);
  if (finding === null) continue;

  const label = `${id}  ${license ?? "(no license field)"}`;
  if (finding === "forbidden") {
    forbidden.push(label);
  } else if (inShippedPath) {
    shippedViolations.push(label);
  } else if (DEV_TOOLCHAIN_EXCEPTIONS.has(id)) {
    const fileCheck = EXCEPTION_LICENSE_FILE_CHECKS.get(id);
    if (fileCheck) {
      const licensePath = join(dir, fileCheck.file);
      const ok =
        existsSync(licensePath) && readFileSync(licensePath, "utf8").includes(fileCheck.mustContain);
      if (!ok) {
        devUnreviewed.push(`${label}  (on-disk license verification FAILED)`);
        continue;
      }
    }
    devReviewed.push(`${label}\n      ↳ ${DEV_TOOLCHAIN_EXCEPTIONS.get(id)}`);
  } else {
    devUnreviewed.push(label);
  }
}

console.log("=== G-LIC dependency license scan ===");
console.log(`total distinct packages: ${packages.size}`);
console.log(`shipped dependency path (prod, transitive, all workspace projects): ${shipped.size}`);
console.log("\n--- license histogram ---");
for (const [license, count] of [...histogram].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4)} ${license}`);
}

console.log("\n--- FORBIDDEN anywhere (AGPL/SSPL/OSL/EUPL/CPAL/RPL) ---");
console.log(forbidden.length === 0 ? "  none" : forbidden.map(l => `  ${l}`).join("\n"));

console.log("\n--- SHIPPED-PATH violations (copyleft or undeclared in prod deps) ---");
console.log(
  shippedViolations.length === 0 ? "  none" : shippedViolations.map(l => `  ${l}`).join("\n"),
);

console.log("\n--- dev-toolchain findings WITHOUT a reviewed exception ---");
console.log(devUnreviewed.length === 0 ? "  none" : devUnreviewed.map(l => `  ${l}`).join("\n"));

console.log("\n--- dev-toolchain reviewed exceptions (DECISIONS D-031) ---");
console.log(devReviewed.length === 0 ? "  none" : devReviewed.map(l => `  ${l}`).join("\n"));

console.log("\n--- direct @x402/* and @stellar/* ---");
for (const [id, { license }] of [...packages].sort()) {
  if (id.startsWith("@x402/") || id.startsWith("@stellar/")) {
    console.log(`  ${id.padEnd(32)} ${license}`);
  }
}

const failures = forbidden.length + shippedViolations.length + devUnreviewed.length;
console.log(
  `\nGATE G-LIC: ${
    failures === 0
      ? "PASS — shipped path clean; dev-toolchain findings all carry reviewed exceptions"
      : "FAIL"
  }`,
);
process.exit(failures === 0 ? 0 : 1);
