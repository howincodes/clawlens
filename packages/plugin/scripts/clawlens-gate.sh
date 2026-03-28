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

# Check if server blocked the session (killed/paused)
if echo "$RESP" | grep -q '"continue".*false'; then
  claude auth logout >/dev/null 2>&1 &
fi

[ -n "$RESP" ] && echo "$RESP"
