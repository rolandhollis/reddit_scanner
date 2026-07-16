#!/usr/bin/env bash
# End-to-end API smoke test. Boot the API (AUTH_MODE=mock, seeded DB)
# and exercise the full lifecycle: user roster, config, list CRUD, mention
# CRUD + CSV export, and a stubbed scan trigger.
#
# Reddit / email network calls are NOT exercised — the scan endpoint runs
# in test mode (SCAN_TEST_MODE=1) which skips outbound HTTP and just
# writes a synthetic mention row so the dedupe path is covered.
#
# Runs against localhost:4000. CI boots the API before calling this.
set -euo pipefail

API="${API:-http://localhost:4000/api}"

# Any mock user id works — pick the seeded admin so we exercise the
# admin-only write paths too.
ADMIN_HEADER="x-mock-user-id: 00000000-0000-0000-0000-000000000001"

expect_status() {
  local method=$1 path=$2 want=$3 body=${4:-}
  local args=(-sS -o /tmp/resp -w "%{http_code}" -X "$method" "$API$path" -H "$ADMIN_HEADER")
  if [ -n "$body" ]; then
    args+=(-H "content-type: application/json" -d "$body")
  fi
  local got
  got=$(curl "${args[@]}")
  if [ "$got" != "$want" ]; then
    echo "FAIL: $method $path -> $got (want $want)"
    echo "----- response body:"
    cat /tmp/resp
    echo
    exit 1
  fi
  echo "  ok  $method $path -> $got"
}

echo "==> health"
curl -fsS "$API/health" >/dev/null

echo "==> config (GET / PUT)"
expect_status GET /config 200
expect_status PUT /config 200 '{"lookback_days":30,"search_scope":"all","subreddits":[],"schedule_cron":"0 9 * * 1,3,5","schedule_timezone":"America/Chicago","recipient_emails":["ops@example.com"],"send_email_when_no_new_items":false}'

# Suffix keeps CRUD idempotent — seed already contains most obvious names.
SUFFIX="$(date +%s)-$$"

echo "==> search terms CRUD"
NEW_TERM=$(curl -fsS -X POST "$API/search-terms" -H "$ADMIN_HEADER" -H "content-type: application/json" \
  -d "{\"term\":\"SmokeTest-$SUFFIX\"}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
[ -n "$NEW_TERM" ] || { echo "FAIL: no id returned from POST /search-terms"; exit 1; }
expect_status GET /search-terms 200
expect_status PUT /search-terms/$NEW_TERM 200 "{\"term\":\"SmokeTest-$SUFFIX\",\"active\":true}"
expect_status DELETE /search-terms/$NEW_TERM 204

echo "==> negative keywords CRUD"
NK=$(curl -fsS -X POST "$API/negative-keywords" -H "$ADMIN_HEADER" -H "content-type: application/json" \
  -d "{\"keyword\":\"smoke-$SUFFIX\"}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
expect_status GET /negative-keywords 200
expect_status DELETE /negative-keywords/$NK 204

echo "==> topic keywords CRUD"
TK=$(curl -fsS -X POST "$API/topic-keywords" -H "$ADMIN_HEADER" -H "content-type: application/json" \
  -d "{\"keyword\":\"smoke-topic-$SUFFIX\",\"topic_label\":\"SmokeTopic\"}" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
expect_status GET /topic-keywords 200
expect_status DELETE /topic-keywords/$TK 204

echo "==> synthetic scan run (test mode)"
expect_status POST /scan/run 200 '{"test_mode":true}'

echo "==> mentions list + CSV"
expect_status GET /mentions 200
CSV_STATUS=$(curl -sS -o /tmp/mentions.csv -w "%{http_code}" "$API/mentions/export.csv" -H "$ADMIN_HEADER")
if [ "$CSV_STATUS" != "200" ]; then
  echo "FAIL: GET /mentions/export.csv -> $CSV_STATUS"
  cat /tmp/mentions.csv
  exit 1
fi
# Suggested Topic has a comma in the middle so we grep pieces.
head -1 /tmp/mentions.csv | grep -q "Date Found,Post Date,Type,Permalink" \
  || { echo "FAIL: CSV header start mismatch"; head -1 /tmp/mentions.csv; exit 1; }
head -1 /tmp/mentions.csv | grep -q "Topic (Confirmed),Actually Negative?,Status,Worked By,Worked Date,Notes" \
  || { echo "FAIL: CSV header tail mismatch"; head -1 /tmp/mentions.csv; exit 1; }
echo "  ok  GET /mentions/export.csv -> 200 (header matches PRD spec)"

echo "==> scan history"
expect_status GET /scan/runs 200

echo
echo "All smoke checks passed."
