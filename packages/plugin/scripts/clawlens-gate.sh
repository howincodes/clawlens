#!/bin/bash
# ClawLens Tier 3 session gate — checks status, enforces kill switch
# This script is installed by enforce.sh --tier3 into managed settings.
# On kill: runs "claude auth logout" to revoke Claude Code credentials.

INPUT=$(cat)

# Read server config from environment (set by managed settings env block)
SERVER_URL="${CLAWLENS_SERVER}"
AUTH_TOKEN="${CLAWLENS_TOKEN}"

if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  exit 0
fi

RESP=$(curl -sf -m 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$INPUT" \
  "$SERVER_URL/api/v1/hook/session-start" 2>/dev/null)

# Extract user_status using whatever JSON parser is available
if command -v jq >/dev/null 2>&1; then
  STATUS=$(echo "$RESP" | jq -r '.user_status // "active"')
elif command -v node >/dev/null 2>&1; then
  STATUS=$(echo "$RESP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).user_status||'active')}catch{console.log('active')}})")
elif command -v python3 >/dev/null 2>&1; then
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user_status','active'))" 2>/dev/null)
else
  STATUS="active"
fi

if [ "$STATUS" = "killed" ]; then
  claude auth logout >/dev/null 2>&1 &
  echo '{"continue": false, "stopReason": "Access revoked by admin. Contact your team lead."}'
  exit 0
fi

if [ "$STATUS" = "paused" ]; then
  echo '{"continue": false, "stopReason": "Access paused by admin. Contact your team lead."}'
  exit 0
fi

if [ -n "$RESP" ]; then
  echo "$RESP"
fi
