#!/usr/bin/env bash
# STEP 6: quick checks that the stack answers. Safe: reads only, writes nothing.
set -euo pipefail
. "$(dirname "$0")/env.sh"
# WEB_URL / API_URL override the addresses (e.g. to test the floci copy).
api_host=$(tfvar api_host)
scheme=https; [ "$(tfvar https_enabled)" = false ] && scheme=http
web=${WEB_URL:-$(tfvar public_web_url)}
api=${API_URL:-$scheme://$api_host}
[ -n "${API_URL:-}" ] && scheme=${API_URL%%:*}
ok=0; bad=0
check() { # name expected-status url [curl args]
  local name=$1 want=$2 url=$3; shift 3
  local got; got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" "$url")
  if [ "$got" = "$want" ]; then echo "PASS  $name ($got)"; ok=$((ok+1))
  else echo "FAIL  $name: got $got, expected $want  ($url)"; bad=$((bad+1)); fi
}
check "web page loads"              200 "$web/"
check "web health"                  200 "$web/healthz"
check "api health"                  200 "$api/api/health"
check "api needs login"             401 "$api/api/projects"
check "webhook rejects no secret"   401 "$api/webhooks/ted/cancel" -X POST -H 'Content-Type: application/json' -d '{"runId":"smoke-test"}'
check "recording start needs login" 401 "$api/api/recordings/start" -X POST -H 'Content-Type: application/json' -d '{}'
[ "$scheme" = https ] && check "http redirects to https" 301 "http://$api_host/api/health"
echo; echo "$ok passed, $bad failed"
[ "$bad" = 0 ]
