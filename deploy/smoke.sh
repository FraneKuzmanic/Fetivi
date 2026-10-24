#!/usr/bin/env bash
# Post-deploy smoke check. Runs inside the tools container on the Compose network, where the four
# public names resolve to Caddy:  compose run --rm tools deploy/smoke.sh
# The database and backup checks need the postgres container and live in deploy.sh instead.
set -euo pipefail

: "${DOMAIN:?DOMAIN is not set}"
APP="https://app.$DOMAIN"
HOST="https://host.$DOMAIN"
MCP="https://mcp.$DOMAIN"
SANDBOX="https://sandbox.$DOMAIN"
CURL=(curl -sS --max-time 15 ${SMOKE_CACERT:+--cacert "$SMOKE_CACERT"})
# Pin each name to what the container's resolver says (Caddy, via the Compose aliases): curl
# would otherwise send every *.localhost name to loopback without asking DNS.
for name in app host mcp sandbox; do
  ip="$(getent hosts "$name.$DOMAIN" | awk '{ print $1; exit }')"
  [[ -n "$ip" ]] || { echo "FAIL  $name.$DOMAIN does not resolve"; exit 1; }
  CURL+=(--resolve "$name.$DOMAIN:443:$ip")
done

fails=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s: %s\n' "$1" "$2"
  fails=$((fails + 1))
}

# check <name> <expected status> <body must contain or ""> <curl args...>
check() {
  local name="$1" want="$2" needle="$3"
  shift 3
  local code
  code="$("${CURL[@]}" -o "$work/body" -D "$work/headers" -w '%{http_code}' "$@" 2>"$work/err")" || {
    fail "$name" "request failed: $(cat "$work/err")"
    return 0
  }
  if [[ "$code" != "$want" ]]; then
    fail "$name" "status $code, expected $want"
  elif [[ -n "$needle" ]] && ! grep -qF -- "$needle" "$work/body"; then
    fail "$name" "body has no $needle"
  else
    pass "$name"
  fi
}

echo "==> smoke check against $DOMAIN"

check "app health" 200 '"status":"ok"' "$APP/health"
check "host health" 200 '"status":"ok"' "$HOST/health"
check "mcp health" 200 '"status":"ok"' "$MCP/health"
check "sandbox health" 200 '"ok":true' "$SANDBOX/health"

check "guest SPA (deep link)" 200 '<div id="root">' "$APP/u/smoke-probe"
check "back-office SPA" 200 '<div id="root">' "$HOST/"

check "JWKS" 200 '"kty":"EC"' "$APP/.well-known/jwks.json"
if grep -qs '"d":' "$work/body"; then fail "JWKS has no private part" "a \"d\" member is published"; fi

check "MCP without a token is 401" 401 "" -X POST -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' --data '{}' "$MCP/stay"
if grep -qi '^www-authenticate:' "$work/headers"; then
  pass "MCP 401 carries WWW-Authenticate"
else
  fail "MCP 401 carries WWW-Authenticate" "header missing"
fi

# The proxy sets the widget CSP itself; Caddy must not add a second one.
check "sandbox page" 200 "" "$SANDBOX/sandbox.html?csp=%7B%7D"
csp_count="$(grep -ci '^content-security-policy:' "$work/headers" || true)"
if [[ "$csp_count" == "1" ]] && grep -qi "frame-ancestors $APP" "$work/headers"; then
  pass "sandbox has exactly one CSP header, framed only by $APP"
else
  fail "sandbox has exactly one CSP header" "found $csp_count"
fi

if [[ -n "${SMOKE_UNIT_SLUG:-}" && -n "${SMOKE_PIN:-}" ]]; then
  jar="$work/jar"
  check "guest link works" 204 "" -c "$jar" -b "$jar" "$APP/api/access/$SMOKE_UNIT_SLUG"
  check "guest PIN opens a space" 201 "" -c "$jar" -b "$jar" -X POST \
    -H "Origin: $APP" -H 'Content-Type: application/json' \
    --data "{\"pin\":\"$SMOKE_PIN\",\"language\":\"en\"}" "$APP/api/access/$SMOKE_UNIT_SLUG/pin"
  space_token="$(awk '$6 == "__Host-fetivi_space" { print $7 }' "$jar" | tail -1)"
  if [[ -z "$space_token" ]]; then
    fail "space cookie set" "no __Host-fetivi_space in the jar"
  else
    pass "space cookie set"
    check "guest space loads" 200 "\"unitSlug\":\"$SMOKE_UNIT_SLUG\"" -b "$jar" "$APP/api/space"

    if bearer="$(cd /app/apps/chat-backend && SMOKE_SPACE_TOKEN="$space_token" node --import tsx src/cli/smoke-token.ts 2>"$work/err")" &&
      [[ -n "$bearer" ]]; then
      pass "stay token minted"
      pkg="$(node -p "require.resolve('@modelcontextprotocol/inspector/package.json',{paths:['/app/apps/mcp-servers']})")"
      inspector="$(dirname "$pkg")/$(node -p "require('$pkg').bin['mcp-inspector']")"
      mkdir -p "$work/home"
      if out="$(HOME="$work/home" USERPROFILE="$work/home" MCP_CATALOG_PATH="$work/home/mcp.json" \
        timeout 60 node "$inspector" --cli --server-url "$MCP/stay" --transport http \
        --header "Authorization: Bearer $bearer" --method tools/list 2>&1)" &&
        grep -q draft_host_message <<<"$out" && grep -q send_host_message <<<"$out"; then
        pass "MCP Inspector tools/list on $MCP/stay"
      else
        fail "MCP Inspector tools/list on $MCP/stay" "$(head -c 500 <<<"$out")"
      fi
    else
      fail "stay token minted" "$(cat "$work/err")"
    fi
  fi
else
  echo "SKIPPED: guest PIN flow and Inspector (set SMOKE_UNIT_SLUG and SMOKE_PIN in deploy/.env)"
fi

if ((fails > 0)); then
  echo "==> smoke check FAILED ($fails)"
  exit 1
fi
echo "==> smoke check passed"
