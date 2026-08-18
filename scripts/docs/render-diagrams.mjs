#!/usr/bin/env node
/**
 * Renders docs/diagrams/*.mmd to committed SVGs (writing rule R6).
 *
 * Every rendered SVG carries a trailing `<!-- mmd-source-sha256:... -->` marker
 * naming the exact source it was rendered from. `docs:check` recomputes the hash
 * and fails on mismatch, which is what makes a stale SVG a CI failure instead of
 * a silent divergence. Mermaid's SVG output is not byte-deterministic across
 * environments, so staleness is defined by the source hash, never by diffing SVGs.
 *
 * Run via `pnpm docs:gen`. Rendering uses @mermaid-js/mermaid-cli (headless
 * Chromium; see scripts/docs/puppeteer-config.json for the sandbox flags).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
/** Directories holding .mmd sources whose SVGs are committed (rule R6). */
const DIAGRAM_DIRS = [resolve(REPO_ROOT, "docs", "diagrams"), resolve(REPO_ROOT, "docs", "scf")];
const MMDC = resolve(REPO_ROOT, "node_modules", ".bin", "mmdc");
const PUPPETEER_CONFIG = join(HERE, "puppeteer-config.json");

export const MARKER_PREFIX = "<!-- mmd-source-sha256:";

/**
 * Hashes a diagram source.
 *
 * @param path - Path to the .mmd file.
 * @returns Hex SHA-256 of its bytes.
 */
export function sourceHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Reads the source-hash marker out of a rendered SVG.
 *
 * @param svgPath - Path to the .svg file.
 * @returns The recorded hash, or null when the marker is absent.
 */
export function recordedHash(svgPath) {
  if (!existsSync(svgPath)) return null;
  const match = readFileSync(svgPath, "utf8").match(/<!-- mmd-source-sha256:([0-9a-f]{64}) -->/);
  return match ? match[1] : null;
}

const force = process.argv.includes("--force");
const sources = DIAGRAM_DIRS.flatMap(dir =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter(name => name.endsWith(".mmd"))
        .sort()
        .map(name => ({ dir, name }))
    : [],
);

if (sources.length === 0) {
  console.error(`render-diagrams: no .mmd sources in ${DIAGRAM_DIRS.join(", ")}`);
  process.exit(1);
}

let rendered = 0;
let current = 0;
for (const { dir, name } of sources) {
  const mmdPath = join(dir, name);
  const svgPath = join(dir, name.replace(/\.mmd$/, ".svg"));
  const hash = sourceHash(mmdPath);

  if (!force && recordedHash(svgPath) === hash) {
    current += 1;
    continue;
  }

  const result = spawnSync(
    MMDC,
    ["-i", mmdPath, "-o", svgPath, "-b", "white", "-p", PUPPETEER_CONFIG, "--quiet"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(`render-diagrams: mmdc failed on ${name}:`);
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
  // mmdc writes the SVG as a single line; the marker rides a trailing comment.
  appendFileSync(svgPath, `\n${MARKER_PREFIX}${hash} -->\n`);
  rendered += 1;
  console.log(`render-diagrams: rendered ${name}`);
}

console.log(`render-diagrams: ${rendered} rendered, ${current} already current`);
