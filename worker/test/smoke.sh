#!/usr/bin/env bash
# End-to-end checks against a running worker.
#
#   Terminal 1:  cd worker && npx wrangler dev
#   Terminal 2:  cd worker && ./test/smoke.sh
#
# Against a deployed environment:
#   BASE=https://blog-sync-staging.<sub>.workers.dev TOKEN=<token> ./test/smoke.sh
#
# Local `wrangler dev` reads .dev.vars for SYNC_TOKEN; the default below matches
# the .dev.vars this repo ships.

set -uo pipefail

BASE="${BASE:-http://localhost:8787}"
TOKEN="${TOKEN:-dev-token-not-a-secret}"
AUTH="Authorization: Bearer ${TOKEN}"
CT="Content-Type: application/json"

pass=0; fail=0
GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'

check() { # check <description> <actual> <expected>
  if [ "$2" = "$3" ]; then
    printf "  %sok%s   %s\n" "$GREEN" "$OFF" "$1"; pass=$((pass+1))
  else
    printf "  %sFAIL%s %s\n       expected %s, got %s\n" "$RED" "$OFF" "$1" "$3" "$2"; fail=$((fail+1))
  fi
}

post() { curl -s -X POST "$BASE$1" -H "$AUTH" -H "$CT" -d "$2"; }
get()  { curl -s "$BASE$1" -H "$AUTH"; }
jqr()  { printf '%s' "$1" | jq -r "$2"; }

command -v jq >/dev/null || { echo "smoke.sh needs jq (brew install jq)"; exit 1; }

# A unique suffix per run keeps repeated runs independent without resetting the DB.
RUN="$(date +%s)-$RANDOM"
U="https://example.com/smoke/$RUN/post"

echo
echo "${DIM}base: $BASE${OFF}"
echo

# ---------------------------------------------------------------- auth
echo "auth"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")
check "no bearer token is rejected" "$code" "401"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health" -H "Authorization: Bearer wrong")
check "wrong bearer token is rejected" "$code" "401"

h=$(get /api/health)
check "health responds ok" "$(jqr "$h" .ok)" "true"
check "urlkey_version is pinned" "$(jqr "$h" .urlkey_version)" "1"

# ---------------------------------------------------------------- capture + dedupe
echo
echo "capture"
r=$(post /api/capture "{\"url\":\"$U\",\"status\":\"read\",\"rating\":3,\"title\":\"Smoke\",\"source\":\"ios\"}")
check "first capture creates the entry" "$(jqr "$r" .action)" "created"
check "  and is not flagged as a re-read"  "$(jqr "$r" .reread)"  "false"
check "  and returns a formatted message"  "$(jqr "$r" '.message | test("Saved · ★★★ ·")')" "true"

r=$(post /api/capture "{\"url\":\"$U\",\"status\":\"read\",\"rating\":5,\"source\":\"ios\"}")
check "same-day recapture updates, not duplicates" "$(jqr "$r" .action)" "updated"
check "  and is still not a re-read"               "$(jqr "$r" .reread)" "false"

n=$(get "/api/list?status=read&limit=500" | jq --arg u "$U" '[.items[] | select(.url == $u)] | length')
check "still exactly one entry" "$n" "1"
rc=$(get "/api/list?status=read&limit=500" | jq --arg u "$U" '.items[] | select(.url == $u) | .read_count')
check "still exactly one read event (24h dedupe window)" "$rc" "1"
rt=$(get "/api/list?status=read&limit=500" | jq --arg u "$U" '.items[] | select(.url == $u) | .rating')
check "rating rose 3 -> 5 (MAX, not overwrite)" "$rt" "5"

# The rule that matters most: a phone capture must never downgrade a laptop rating.
r=$(post /api/capture "{\"url\":\"$U\",\"status\":\"toread\",\"rating\":0,\"source\":\"ios\"}")
st=$(get "/api/list?status=read&limit=500" | jq -r --arg u "$U" '.items[] | select(.url == $u) | .status')
check "re-queueing something already read keeps status=read" "$st" "read"
rt=$(get "/api/list?status=read&limit=500" | jq -r --arg u "$U" '.items[] | select(.url == $u) | .rating')
check "  and does NOT wipe the 5-star rating" "$rt" "5"

# ---------------------------------------------------------------- re-reads
echo
echo "re-reads (the core requirement)"
OLD=$(( ($(date +%s) - 300*86400) * 1000 ))
r=$(post /api/capture "{\"url\":\"$U\",\"status\":\"read\",\"rating\":4,\"read_at\":$OLD,\"source\":\"ext\"}")
check "a read 300 days earlier is a separate event" "$(jqr "$r" .reread)" "true"
rc=$(get "/api/list?status=read&limit=500" | jq --arg u "$U" '.items[] | select(.url == $u) | .read_count')
check "  so the article now has 2 read events" "$rc" "2"
rt=$(get "/api/list?status=read&limit=500" | jq -r --arg u "$U" '.items[] | select(.url == $u) | .rating')
check "  and the displayed rating is the most recent read's" "$rt" "5"

# ---------------------------------------------------------------- url normalization
echo
echo "url normalization"
post /api/capture "{\"url\":\"$U/?utm_source=newsletter&fbclid=xyz\",\"status\":\"read\",\"rating\":1}" >/dev/null
n=$(get "/api/list?status=read&limit=500" | jq --arg u "$U" '[.items[] | select(.url_key == ($u))] | length')
check "a utm_/fbclid variant maps to the same entry" "$n" "1"

r=$(post /api/capture '{"url":"not a url","status":"read"}')
check "an unusable link is rejected" "$(jqr "$r" .error)" "bad_url"

# ---------------------------------------------------------------- pull cursor
echo
echo "pull cursor"
p=$(get "/api/pull?since=0&limit=1000")
check "pull from 0 returns rows" "$(jqr "$p" '.entries | length > 0')" "true"
NEXT=$(jqr "$p" .next_since)
p2=$(get "/api/pull?since=$NEXT")
check "pull from the cursor returns nothing new" \
  "$(jqr "$p2" '((.entries | length) + (.reads | length))')" "0"
check "  and holds the cursor steady" "$(jqr "$p2" .next_since)" "$NEXT"

# ---------------------------------------------------------------- push idempotence
echo
echo "push"
P="https://example.com/push/$RUN"
BODY=$(cat <<EOF
{"mode":"merge","entries":[
 {"url":"$P/a","title":"A","author":"Ann","status":"read","reads":[{"read_at":1700000000000,"rating":5}]},
 {"url":"$P/b","title":"B","status":"toread"},
 {"url":"$P/c","title":"C","status":"read","reads":[{"read_at":1700000000000,"rating":2}]}
]}
EOF
)
r=$(post /api/push "$BODY")
check "push applies 3 entries + 2 reads" "$(jqr "$r" .applied)" "5"
S1=$(jqr "$r" .next_since)

r=$(post /api/push "$BODY")
check "re-pushing the identical batch applies nothing" "$(jqr "$r" .applied)" "0"
check "  and does not advance the cursor (no pull loop)" "$(jqr "$r" .next_since)" "$S1"

r=$(post /api/push "{\"mode\":\"merge\",\"entries\":[{\"url\":\"$P/a\",\"author\":\"\",\"title\":\"\"}]}")
au=$(jqr "$r" '.entries[] | select(.url_key | endswith("/a")) | .author')
check "an empty author does not blank out a real one" "$au" "Ann"

# ---------------------------------------------------------------- rate + delete
echo
echo "rate and delete"
RID=$(get "/api/list?status=read&limit=500" | jq -r --arg u "$P/c" '.items[] | select(.url == $u) | .read_id')
r=$(post /api/rate "{\"items\":[{\"url_key\":\"$P/c\",\"read_id\":\"$RID\",\"rating\":1}]}")
rt=$(get "/api/list?status=read&limit=500" | jq -r --arg u "$P/c" '.items[] | select(.url == $u) | .rating')
check "an explicit rating CAN downgrade 2 -> 1 (force)" "$rt" "1"

post /api/delete "{\"url_keys\":[\"$P/b\"]}" >/dev/null
n=$(get "/api/list?status=toread&limit=500" | jq --arg u "$P/b" '[.items[] | select(.url == $u)] | length')
check "a deleted entry leaves the list" "$n" "0"
t=$(get "/api/pull?since=0&limit=1000" | jq --arg u "$P/b" '[.entries[] | select(.url == $u and .deleted_at != null)] | length')
check "  but appears as a tombstone in pull" "$t" "1"

# ---------------------------------------------------------------- title backfill
echo
echo "title backfill"
post /api/capture "{\"url\":\"https://example.com/\",\"status\":\"read\",\"rating\":1}" >/dev/null
sleep 5
tt=$(get "/api/list?status=read&limit=500" | jq -r '.items[] | select(.url_key == "https://example.com") | .title')
check "a capture with no title gets one filled in" "$([ -n "$tt" ] && [ "$tt" != "null" ] && echo yes || echo no)" "yes"

# ----------------------------------------------------------------
echo
if [ "$fail" -eq 0 ]; then
  printf "%s%d passed%s\n\n" "$GREEN" "$pass" "$OFF"
else
  printf "%s%d failed%s, %d passed\n\n" "$RED" "$fail" "$OFF" "$pass"
fi
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
