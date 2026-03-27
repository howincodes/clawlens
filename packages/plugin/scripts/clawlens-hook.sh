#!/bin/bash
# ClawLens hook handler for command-only events (SessionStart, FileChanged)
# Claude Code only supports type:"command" for these events.
# This script reads the hook JSON from stdin, POSTs it to the ClawLens server,
# and outputs the server's response (which may contain blocking decisions).

INPUT=$(cat)

# Extract event name to determine API path
EVENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null)

# Map event names to API path suffixes
case "$EVENT" in
  SessionStart) PATH_SUFFIX="session-start" ;;
  FileChanged)  PATH_SUFFIX="file-changed" ;;
  *)            PATH_SUFFIX="unknown" ;;
esac

# Determine server URL and token from plugin env vars
# Claude Code exports userConfig values as CLAUDE_PLUGIN_OPTION_<KEY>
SERVER_URL="${CLAUDE_PLUGIN_OPTION_SERVER_URL}"
AUTH_TOKEN="${CLAUDE_PLUGIN_OPTION_AUTH_TOKEN}"

# Fallback: check if running under managed settings (Tier 2/3)
if [ -z "$SERVER_URL" ]; then
  SERVER_URL="${CLAWLENS_SERVER}"
fi
if [ -z "$AUTH_TOKEN" ]; then
  AUTH_TOKEN="${CLAWLENS_TOKEN}"
fi

# If still no server URL, exit silently (fail-open)
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  exit 0
fi

# POST to server and output response
RESP=$(curl -sf -m 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$INPUT" \
  "${SERVER_URL}/api/v1/hook/${PATH_SUFFIX}" 2>/dev/null)

# Output response if non-empty (may contain blocking decisions)
if [ -n "$RESP" ]; then
  echo "$RESP"
fi
