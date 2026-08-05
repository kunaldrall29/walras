#!/usr/bin/env node
/**
 * Builds the static documentation site (docs.walras.space) into dist-site/.
 *
 * Deliberately small and deterministic: markdown-it (MIT, license-checked per
 * gate GD.3) plus one template, no client-side JavaScript. Every relative link
 * is resolved against the repository tree at build time and rewritten to one of:
 * a rendered page, a copied asset (SVGs, .mmd sources, openapi.yaml), or a
 * GitHub URL for source files that are not part of the site — so the site can
 * never ship a link the repository does not back.
 *
 * Run: node scripts/docs/build-site.mjs   (requires committed docs — it reads
 * the working tree; the footer stamps the current HEAD commit).
 */
import { execSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(REPO_ROOT, "dist-site");
const GITHUB = "https://github.com/kunaldrall29/walras";
const BRANCH = "session-0-verification";
const COMMIT = execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT }).toString().trim();

/** repo-relative markdown source → site route (root-absolute, .html). */
const PAGES = new Map([
  ["README.md", "/index.html"],
  ["SECURITY.md", "/security.html"],
  ["CONTRIBUTING.md", "/contributing.html"],
  ["docs/quickstart.md", "/quickstart.html"],
  ["docs/faq.md", "/faq.html"],
  ["docs/glossary.md", "/glossary.html"],
  ["docs/guides/sell.md", "/guides/sell.html"],
  ["docs/guides/buy-agent.md", "/guides/buy-agent.html"],
  ["docs/guides/operate.md", "/guides/operate.html"],
  ["docs/runbook.md", "/runbook.html"],
  ["docs/ARCHITECTURE.md", "/architecture.html"],
  ["docs/MODELS.md", "/models.html"],
  ["docs/THREAT-MODEL.md", "/threat-model.html"],
  ["docs/litepaper/walras-litepaper.md", "/litepaper/index.html"],
  ["docs/litepaper/ABSTRACT.md", "/litepaper/abstract.html"],
  ["docs/reference/config.md", "/reference/config.html"],
  ["docs/reference/errors.md", "/reference/errors.html"],
  ["docs/FACTS.md", "/facts.html"],
  ["docs/DECISIONS.md", "/decisions.html"],
  ["docs/EVIDENCE.md", "/evidence.html"],
  ["docs/rfp.md", "/rfp.html"],
  ["docs/scf/stack-explanation.md", "/scf/stack-explanation.html"],
  ["docs/scf/decentralization.md", "/scf/decentralization.html"],
  ["docs/scf/infrastructure.md", "/scf/infrastructure.html"],
  ["docs/scf/privacy.md", "/scf/privacy.html"],
  ["docs/scf/maintenance.md", "/scf/maintenance.html"],
  ["docs/scf/licensing.md", "/scf/licensing.html"],
]);

/** repo-relative asset directories copied verbatim. */
const ASSET_DIRS = new Map([
  ["docs/diagrams", "/diagrams"],
  ["docs/api", "/api"],
]);
/** individual asset files (repo-relative → site path). */
const ASSET_FILES = new Map([
  ["docs/scf/high-level-diagram.mmd", "/scf/high-level-diagram.mmd"],
  ["docs/scf/high-level-diagram.svg", "/scf/high-level-diagram.svg"],
]);

/** Sidebar: group title → [site route, label]. */
const NAV = [
  ["Start", [
    ["/index.html", "Overview"],
    ["/quickstart.html", "Quickstart"],
    ["/faq.html", "FAQ"],
    ["/glossary.html", "Glossary"],
  ]],
  ["Guides", [
    ["/guides/sell.html", "Sell"],
    ["/guides/buy-agent.html", "Buy / agent"],
    ["/guides/operate.html", "Operate"],
    ["/runbook.html", "Runbook"],
  ]],
  ["Design", [
    ["/architecture.html", "Architecture"],
    ["/models.html", "Models"],
    ["/threat-model.html", "Threat model"],
    ["/litepaper/index.html", "Litepaper"],
    ["/litepaper/abstract.html", "Abstract"],
  ]],
  ["Reference", [
    ["/reference/config.html", "Configuration"],
    ["/reference/errors.html", "Error registry"],
    ["/api/openapi.yaml", "OpenAPI (YAML)"],
  ]],
  ["Ledgers", [
    ["/facts.html", "FACTS"],
    ["/decisions.html", "DECISIONS"],
    ["/evidence.html", "EVIDENCE"],
    ["/rfp.html", "RFP (verbatim)"],
  ]],
  ["Project", [
    ["/security.html", "Security policy"],
    ["/contributing.html", "Contributing"],
    ["/scf/stack-explanation.html", "SCF snippets"],
  ]],
];

/**
 * Derives a stable heading id, GitHub-style.
 *
 * @param text - Heading text.
 * @returns Slug id.
 */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Rewrites one markdown href from a given source file to a site URL.
 *
 * @param href - The raw href from the markdown.
 * @param sourceRel - Repo-relative path of the markdown file it appears in.
 * @returns The rewritten URL.
 */
function rewriteHref(href, sourceRel) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [pathPart, anchor] = href.split("#");
  const abs = resolve(REPO_ROOT, dirname(sourceRel), pathPart);
  const repoRel = abs.startsWith(REPO_ROOT + sep)
    ? abs.slice(REPO_ROOT.length + 1).split(sep).join(posix.sep)
    : null;
  const suffix = anchor ? `#${anchor}` : "";

  if (repoRel === null) {
    throw new Error(`${sourceRel}: link escapes the repository: ${href}`);
  }
  if (PAGES.has(repoRel)) return PAGES.get(repoRel) + suffix;
  for (const [dir, sitePath] of ASSET_DIRS) {
    if (repoRel.startsWith(dir + "/")) return sitePath + repoRel.slice(dir.length) + suffix;
  }
  if (ASSET_FILES.has(repoRel)) return ASSET_FILES.get(repoRel) + suffix;
  if (!existsSync(abs)) {
    throw new Error(`${sourceRel}: link target missing from the repository: ${href}`);
  }
  const kind = repoRel.includes(".") ? "blob" : "tree";
  return `${GITHUB}/${kind}/${BRANCH}/${repoRel}`;
}

const md = new MarkdownIt({ html: true, linkify: false });

// Wide tables (FACTS, the error registry) must scroll inside their own box.
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
md.renderer.rules.table_close = () => "</table></div>";

/**
 * Renders one markdown source to a full HTML page.
 *
 * @param sourceRel - Repo-relative markdown path.
 * @param route - Site route for the page.
 * @returns Full HTML document.
 */
function renderPage(sourceRel, route) {
  const raw = readFileSync(join(REPO_ROOT, sourceRel), "utf8");
  const env = {};
  const tokens = md.parse(raw, env);

  let title = "walras";
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open" && token.tag === "h1" && tokens[i + 1]?.type === "inline") {
      title = tokens[i + 1].content.replace(/[`*]/g, "");
      break;
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "heading_open" && tokens[i + 1]?.type === "inline") {
      token.attrSet("id", slug(tokens[i + 1].content));
    }
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type === "link_open") {
        const href = child.attrGet("href");
        if (href) child.attrSet("href", rewriteHref(href, sourceRel));
      }
      if (child.type === "image") {
        const src = child.attrGet("src");
        if (src) child.attrSet("src", rewriteHref(src, sourceRel));
      }
    }
  }

  const body = md.renderer.render(tokens, md.options, env);
  const nav = NAV.map(
    ([group, items]) =>
      `<div class="nav-group"><div class="nav-title">${group}</div>${items
        .map(
          ([itemRoute, label]) =>
            `<a href="${itemRoute}"${itemRoute === route ? ' class="active"' : ""}>${label}</a>`,
        )
        .join("")}</div>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — walras docs</title>
<style>
:root{--bg:#ffffff;--fg:#1c2733;--muted:#5b6b7b;--line:#e3e8ee;--accent:#0f62fe;--code-bg:#f4f6f8;--side:#f8fafb}
@media (prefers-color-scheme:dark){:root{--bg:#11161c;--fg:#dbe4ec;--muted:#8b9aa9;--line:#2a3440;--accent:#6ea8ff;--code-bg:#1a222b;--side:#151c23}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);display:flex;min-height:100vh}
nav{width:230px;flex:none;border-right:1px solid var(--line);background:var(--side);padding:1.2rem .9rem;position:sticky;top:0;height:100vh;overflow-y:auto}
nav .brand{font-weight:700;font-size:1.05rem;margin-bottom:1rem;display:block;color:var(--fg);text-decoration:none}
.nav-title{font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:1rem 0 .3rem}
nav a{display:block;padding:.18rem .5rem;border-radius:6px;color:var(--fg);text-decoration:none;font-size:.92rem}
nav a:hover{background:var(--line)}
nav a.active{color:var(--accent);font-weight:600}
main{flex:1;min-width:0;padding:2.2rem clamp(1rem,4vw,3.2rem);max-width:56rem}
h1,h2,h3,h4{line-height:1.3;scroll-margin-top:1rem}
h1{font-size:1.7rem;border-bottom:1px solid var(--line);padding-bottom:.4rem}
h2{font-size:1.32rem;margin-top:2.2rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}
a{color:var(--accent)}
code{font:.86em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code-bg);padding:.1em .35em;border-radius:4px}
pre{background:var(--code-bg);padding:.9rem 1rem;border-radius:8px;overflow-x:auto;line-height:1.5}
pre code{background:none;padding:0}
.table-wrap{overflow-x:auto;margin:1rem 0}
table{border-collapse:collapse;font-size:.9rem;min-width:100%}
th,td{border:1px solid var(--line);padding:.42rem .6rem;text-align:left;vertical-align:top}
th{background:var(--code-bg)}
img{max-width:100%;height:auto;background:#fff;border:1px solid var(--line);border-radius:8px}
blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:3px solid var(--line);color:var(--muted)}
footer{margin-top:3rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.82rem;color:var(--muted)}
@media (max-width:820px){body{flex-direction:column}nav{width:100%;height:auto;position:static;display:flex;flex-wrap:wrap;gap:.1rem .8rem}nav .brand{width:100%}.nav-group{margin-right:.6rem}}
</style>
</head>
<body>
<nav><a class="brand" href="/index.html">walras</a>${nav}</nav>
<main>
${body}
<footer>Generated from <a href="${GITHUB}/tree/${BRANCH}">${BRANCH}</a> @ <code>${COMMIT}</code> · Apache-2.0 · testnet, unaudited — see the <a href="/threat-model.html">threat model</a>.</footer>
</main>
</body>
</html>
`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [dir, sitePath] of ASSET_DIRS) {
  cpSync(join(REPO_ROOT, dir), join(OUT, sitePath.slice(1)), { recursive: true });
}
for (const [file, sitePath] of ASSET_FILES) {
  mkdirSync(dirname(join(OUT, sitePath.slice(1))), { recursive: true });
  cpSync(join(REPO_ROOT, file), join(OUT, sitePath.slice(1)));
}

let pages = 0;
for (const [sourceRel, route] of PAGES) {
  const outPath = join(OUT, route.slice(1));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, renderPage(sourceRel, route));
  pages += 1;
}

console.log(`build-site: ${pages} pages + assets → ${OUT} (commit ${COMMIT})`);
