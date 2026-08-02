#!/usr/bin/env bash
# Captures curl transcripts for every facilitator route against a running instance.
#
#   scripts/capture-transcripts.sh <base-url> <case-name>...
#
# Emits raw request/response pairs on stdout, ready to paste into docs/EVIDENCE.md.
# Payment payloads come from the committed fixture set so a transcript is reproducible.
set -euo pipefail

BASE_URL="${1:?usage: capture-transcripts.sh <base-url> <case>...}"
shift
FIXTURES="$(dirname "$0")/../packages/facilitator/test/fixtures/exact-stellar.json"

# Emits one labelled request/response pair.
run() {
  local label="$1" method="$2" path="$3" body="${4:-}"
  echo "\$ curl -s -i -X ${method} ${BASE_URL}${path}${body:+ -H 'Content-Type: application/json' -d @${label}.json}"
  # Responses are emitted verbatim apart from CR stripping — headers included.
  if [ -n "${body}" ]; then
    curl -s -i -X "${method}" "${BASE_URL}${path}" \
      -H 'Content-Type: application/json' -d "${body}" | tr -d '\r'
  else
    curl -s -i -X "${method}" "${BASE_URL}${path}" | tr -d '\r'
  fi
  echo
  echo
}

# Builds a spec section 7.1 request body around one fixture case.
body_for() {
  node -e '
    const fs = require("node:fs");
    const f = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const c = f.cases[process.argv[2]];
    if (!c) { console.error(`no fixture case ${process.argv[2]}`); process.exit(1); }
    process.stdout.write(JSON.stringify({
      x402Version: c.payload.x402Version,
      paymentPayload: c.payload,
      paymentRequirements: f.requirements,
    }));
  ' "${FIXTURES}" "$1"
}

echo "### GET /supported"
echo
run supported GET /supported

echo "### GET /health"
echo
run health GET /health

for case_name in "$@"; do
  echo "### POST /verify — ${case_name}"
  echo
  run "verify-${case_name}" POST /verify "$(body_for "${case_name}")"

  echo "### POST /settle — ${case_name}"
  echo
  run "settle-${case_name}" POST /settle "$(body_for "${case_name}")"
done

echo "### POST /verify — malformed request body"
echo
run malformed POST /verify '{not json'

echo "### GET /discovery/resources — not implemented in this session"
echo
run unknown GET /discovery/resources
