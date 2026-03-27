#!/bin/bash
# ClawLens Tier 3 session gate — checks status, enforces kill switch
# This script is installed by enforce.sh --tier3 into managed settings.
# On kill: runs "claude auth logout" to revoke Claude Code credentials.

INPUT=$(cat)

# Read server config from environment (set by managed settings env block)
SERVER_URL="${CLAWLENS_SERVER}"
AUTH_TOKEN="${CLAWLENS_TOKEN}"

if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  # No config = fail-open (can't enforce without server info)
  exit 0
fi

RESP=$(curl -sf -m 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$INPUT" \
  "$SERVER_URL/api/v1/hook/session-start" 2>/dev/null)

# Extract user_status from response
STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user_status','active'))" 2>/dev/null)

if [ "$STATUS" = "killed" ]; then
  # NUCLEAR: revoke Claude Code auth credentials
  claude auth logout >/dev/null 2>&1 &
  echo '{"continue": false, "stopReason": "Access revoked by admin. Contact your team lead."}'
  exit 0
fi

if [ "$STATUS" = "paused" ]; then
  echo '{"continue": false, "stopReason": "Access paused by admin. Contact your team lead."}'
  exit 0
fi

# Pass through server response (may contain additionalContext)
if [ -n "$RESP" ]; then
  echo "$RESP"
fi
