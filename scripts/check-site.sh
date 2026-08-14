#!/usr/bin/env bash
# check-site — is docs.walras.space serving the commit we think it is?
#
# The site is deployed manually and out-of-band: there is no deploy config in
# this repository and no pages job in ci.yml (DECISIONS D-035). Its only deploy
# marker is the footer stamp that scripts/docs/build-site.mjs writes at build
# time from `git rev-parse --short HEAD`. This script reads that stamp back off
# the live site and compares it to a target commit.
#
#   ./scripts/check-site.sh              # compare against HEAD
#   ./scripts/check-site.sh ce3d9ca      # compare against a specific commit
#   SITE_URL=https://staging.example ./scripts/check-site.sh
#
# Exit 0 = the deployed commit matches. Exit 1 = drift (or the site is
# unreachable / the footer is unreadable — all three are things a human needs
# to look at).
#
# Deliberately NOT part of `pnpm test` or ci.yml: it needs network, and a stale
# deploy is an ops condition rather than a broken commit (D-035). Evidence for
# the first run: EVIDENCE Ops-1; the measurement itself is FACTS F-092.
set -euo pipefail
cd "$(dirname "$0")/.."

SITE_URL="${SITE_URL:-https://docs.walras.space}"
EXPECTED_REF="${1:-HEAD}"

fail() { echo "check-site: FAIL — $1" >&2; exit 1; }

command -v curl >/dev/null || fail "curl not on PATH"
git rev-parse --git-dir >/dev/null 2>&1 || fail "not a git repository"

expected="$(git rev-parse --short "$EXPECTED_REF" 2>/dev/null)" \
  || fail "cannot resolve '$EXPECTED_REF' to a commit"

html="$(curl -sS --max-time 20 "$SITE_URL/" 2>/dev/null)" \
  || fail "could not fetch $SITE_URL/ (network, DNS, or the site is down)"

# The footer reads: … @ <code>abc1234</code> · Apache-2.0 · …
deployed="$(printf '%s' "$html" \
  | grep -o '<footer>.*</footer>' \
  | grep -oE '<code>[0-9a-f]{7,40}</code>' \
  | head -1 \
  | sed -E 's#<code>([0-9a-f]+)</code>#\1#' || true)"

[ -n "$deployed" ] || fail \
  "no commit stamp found in the footer of $SITE_URL/ — the deployed build predates the
       stamp, or the footer template changed (see scripts/docs/build-site.mjs)"

echo "check-site: deployed $deployed / expected $expected"

[ "$deployed" = "$expected" ] && { echo "check-site: PASS — $SITE_URL is current"; exit 0; }

# Drift. Say how far and in which direction, so the reader knows whether this is
# a missed redeploy (deployed is an ancestor) or something stranger.
branch="$(git rev-parse --abbrev-ref HEAD)"

if ! git cat-file -e "${deployed}^{commit}" 2>/dev/null; then
  fail "deployed commit $deployed is not in this repository — the site was built from
       another tree, or the branch was rewritten since it was deployed"
fi

if git merge-base --is-ancestor "$deployed" "$expected" 2>/dev/null; then
  behind="$(git rev-list --count "${deployed}..${expected}")"
  echo "check-site: FAIL — $SITE_URL is $behind commit(s) behind $branch" >&2
  git log --oneline "${deployed}..${expected}" | sed 's/^/  /' >&2
  echo "  fix: pnpm docs:site && redeploy dist-site/" >&2
  exit 1
fi

if git merge-base --is-ancestor "$expected" "$deployed" 2>/dev/null; then
  ahead="$(git rev-list --count "${expected}..${deployed}")"
  echo "check-site: FAIL — $SITE_URL is $ahead commit(s) AHEAD of $EXPECTED_REF" >&2
  git log --oneline "${expected}..${deployed}" | sed 's/^/  /' >&2
  [ "$EXPECTED_REF" = "HEAD" ] \
    && echo "  the live site is newer than this working tree — pull before rebuilding" >&2 \
    || echo "  (expected if you passed an older ref deliberately)" >&2
  exit 1
fi

fail "$deployed and $expected have diverged (neither is an ancestor of the other) —
       the live site was built from a different branch"
