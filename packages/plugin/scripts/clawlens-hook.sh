#!/bin/bash
# ClawLens hook handler — universal for ALL hook events
# Reads hook JSON from stdin, POSTs to ClawLens server, outputs response.
# Response may contain blocking decisions (continue:false, decision:block, etc.)

INPUT=$(cat)

# Extract event name using whatever JSON parser is available
if command -v jq >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
elif command -v node >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).hook_event_name||'')}catch{console.log('')}})")
elif command -v python3 >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null)
else
  EVENT=""
fi

# Map event names to API path suffixes
case "$EVENT" in
  SessionStart)       PATH_SUFFIX="session-start" ;;
  UserPromptSubmit)   PATH_SUFFIX="prompt" ;;
  PreToolUse)         PATH_SUFFIX="pre-tool" ;;
  Stop)               PATH_SUFFIX="stop" ;;
  StopFailure)        PATH_SUFFIX="stop-error" ;;
  SessionEnd)         PATH_SUFFIX="session-end" ;;
  PostToolUse)        PATH_SUFFIX="post-tool" ;;
  SubagentStart)      PATH_SUFFIX="subagent-start" ;;
  PostToolUseFailure) PATH_SUFFIX="post-tool-failure" ;;
  ConfigChange)       PATH_SUFFIX="config-change" ;;
  FileChanged)        PATH_SUFFIX="file-changed" ;;
  *)                  exit 0 ;;
esac

# Determine server URL and token
# Plugin env vars (set via settings.json env block)
SERVER_URL="${CLAUDE_PLUGIN_OPTION_SERVER_URL}"
AUTH_TOKEN="${CLAUDE_PLUGIN_OPTION_AUTH_TOKEN}"

# Fallback: managed settings env vars (Tier 2/3)
if [ -z "$SERVER_URL" ]; then SERVER_URL="${CLAWLENS_SERVER}"; fi
if [ -z "$AUTH_TOKEN" ]; then AUTH_TOKEN="${CLAWLENS_TOKEN}"; fi

# No config = fail-open
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  exit 0
fi

# POST to server and output response
RESP=$(curl -sf -m 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$INPUT" \
  "${SERVER_URL}/api/v1/hook/${PATH_SUFFIX}" 2>/dev/null)

if [ -n "$RESP" ]; then
  echo "$RESP"
fi
