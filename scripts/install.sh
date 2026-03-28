#!/bin/bash
set -e

# ClawLens Installer — one-command setup for Claude Code hooks
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh)
#
# This script:
# 1. Checks for claude CLI
# 2. Prompts for server URL and auth token
# 3. Copies the hook script to ~/.claude/hooks/clawlens-hook.sh
# 4. Writes hook configuration into ~/.claude/settings.json (merging, not overwriting)
# 5. Sets env vars in settings.json
# 6. Verifies server connectivity

echo ""
echo "  ClawLens Installer"
echo "  ==================="
echo ""

# ── Pre-flight checks ───────────────────────────────────────────────────────

if ! command -v claude >/dev/null 2>&1; then
  echo "  Error: claude command not found."
  echo "  Install Claude Code first: https://docs.anthropic.com/en/docs/claude-code"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  Error: node command not found."
  echo "  Claude Code requires Node.js — install it first."
  exit 1
fi

echo "  claude: $(command -v claude)"
echo "  node:   $(node --version)"
echo ""

# ── Prompt for config ────────────────────────────────────────────────────────

SERVER_URL=""
while [ -z "$SERVER_URL" ]; do
  printf "  Server URL (e.g. https://clawlens.example.com): "
  read -r SERVER_URL
  SERVER_URL="${SERVER_URL%/}"
  if [ -z "$SERVER_URL" ]; then echo "  URL cannot be empty!"; fi
done

case "$SERVER_URL" in
  http://*|https://*) ;;
  *) echo "  Error: Server URL must start with http:// or https://"; exit 1 ;;
esac

AUTH_TOKEN=""
while [ -z "$AUTH_TOKEN" ]; do
  printf "  Auth token (from admin dashboard): "
  read -r AUTH_TOKEN
  if [ -z "$AUTH_TOKEN" ]; then echo "  Token cannot be empty!"; fi
done

echo ""

# ── Step 1: Install hook script ──────────────────────────────────────────────

echo "[1/3] Installing hook script..."

HOOK_DIR="$HOME/.claude/hooks"
HOOK_SCRIPT="$HOOK_DIR/clawlens-hook.sh"
mkdir -p "$HOOK_DIR"

cat > "$HOOK_SCRIPT" << 'HOOKEOF'
#!/bin/bash
# ClawLens hook handler — universal for ALL hook events
# Reads hook JSON from stdin, POSTs to ClawLens server, outputs response.
# Response may contain blocking decisions (continue:false, decision:block, etc.)

# Save stdin to temp file (avoids shell escaping issues with large JSON)
TMPFILE=$(mktemp 2>/dev/null || echo "/tmp/clawlens-hook-$$")
cat > "$TMPFILE"

# Extract event name — try jq, node, then grep fallback
if command -v jq >/dev/null 2>&1; then
  EVENT=$(jq -r '.hook_event_name // ""' < "$TMPFILE")
elif command -v node >/dev/null 2>&1; then
  EVENT=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).hook_event_name||'')}catch{console.log('')}})" < "$TMPFILE")
else
  EVENT=$(grep -o '"hook_event_name":"[^"]*"' "$TMPFILE" | head -1 | cut -d'"' -f4)
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

# Fallback: managed settings env vars (enforced mode)
if [ -z "$SERVER_URL" ]; then SERVER_URL="${CLAWLENS_SERVER}"; fi
if [ -z "$AUTH_TOKEN" ]; then AUTH_TOKEN="${CLAWLENS_TOKEN}"; fi

# No config = fail-open
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  rm -f "$TMPFILE"
  exit 0
fi

# Enrich SessionStart with subscription info + model detection
if [ "$EVENT" = "SessionStart" ]; then
  # Get subscription email and type from claude auth status
  AUTH_JSON=$(claude auth status 2>/dev/null || true)
  if [ -n "$AUTH_JSON" ]; then
    if command -v jq >/dev/null 2>&1; then
      SUB_EMAIL=$(echo "$AUTH_JSON" | jq -r '.email // ""')
      SUB_TYPE=$(echo "$AUTH_JSON" | jq -r '.subscriptionType // .planType // ""')
    else
      SUB_EMAIL=$(echo "$AUTH_JSON" | grep -o '"email":"[^"]*"' | head -1 | cut -d'"' -f4)
      SUB_TYPE=$(echo "$AUTH_JSON" | grep -o '"subscriptionType":"[^"]*"' | head -1 | cut -d'"' -f4)
    fi
  fi

  # Read model from user settings if not in hook JSON
  if command -v jq >/dev/null 2>&1; then
    HOOK_MODEL=$(jq -r '.model // ""' < "$TMPFILE")
  else
    HOOK_MODEL=$(grep -o '"model":"[^"]*"' "$TMPFILE" | head -1 | cut -d'"' -f4)
  fi

  if [ -z "$HOOK_MODEL" ]; then
    SETTINGS_MODEL=""
    SETTINGS_FILE="$HOME/.claude/settings.json"
    if [ -f "$SETTINGS_FILE" ]; then
      if command -v jq >/dev/null 2>&1; then
        SETTINGS_MODEL=$(jq -r '.model // ""' "$SETTINGS_FILE")
      else
        SETTINGS_MODEL=$(grep -o '"model":"[^"]*"' "$SETTINGS_FILE" | head -1 | cut -d'"' -f4)
      fi
    fi
  fi

  # Build enriched JSON — merge extra fields into the hook JSON
  ENRICH=""
  [ -n "$SUB_EMAIL" ] && ENRICH="${ENRICH}\"subscription_email\":\"$SUB_EMAIL\","
  [ -n "$SUB_TYPE" ] && ENRICH="${ENRICH}\"subscription_type\":\"$SUB_TYPE\","
  [ -n "$SETTINGS_MODEL" ] && ENRICH="${ENRICH}\"detected_model\":\"$SETTINGS_MODEL\","
  ENRICH="${ENRICH}\"hostname\":\"$(hostname 2>/dev/null || echo unknown)\","
  ENRICH="${ENRICH}\"platform\":\"$(uname -s 2>/dev/null || echo unknown)\""

  if [ -n "$ENRICH" ]; then
    # Inject extra fields into the JSON object (before the closing brace)
    sed -i.bak "s/}$/,${ENRICH}}/" "$TMPFILE" 2>/dev/null || \
      sed "s/}$/,${ENRICH}}/" "$TMPFILE" > "${TMPFILE}.new" && mv "${TMPFILE}.new" "$TMPFILE"
    rm -f "${TMPFILE}.bak"
  fi
fi

# POST to server and output response
RESP=$(curl -sf -m 5 -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d @"$TMPFILE" \
  "${SERVER_URL}/api/v1/hook/${PATH_SUFFIX}" 2>/dev/null)

rm -f "$TMPFILE"

if [ -n "$RESP" ]; then
  echo "$RESP"
fi
HOOKEOF

chmod 755 "$HOOK_SCRIPT"
echo "  -> $HOOK_SCRIPT"

# ── Step 2: Configure settings.json ──────────────────────────────────────────

echo "[2/3] Configuring hooks in settings.json..."

SETTINGS_FILE="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"

# Hook configuration JSON (uses absolute path via ~ expansion)
HOOKS_JSON=$(cat << 'HJEOF'
{
  "SessionStart": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 5}]}],
  "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}],
  "PreToolUse": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  "Stop": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}],
  "StopFailure": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  "SessionEnd": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3, "async": true}]}],
  "PostToolUse": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3, "async": true}]}],
  "SubagentStart": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  "PostToolUseFailure": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  "ConfigChange": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}],
  "FileChanged": [{"matcher": "settings.json", "hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}]
}
HJEOF
)

# Merge hooks into existing settings.json using node
node -e "
const fs = require('fs');
const settingsPath = process.env.HOME + '/.claude/settings.json';
let s = {};
try { s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
s.env = s.env || {};
s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL = '$SERVER_URL';
s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN = '$AUTH_TOKEN';
s.hooks = s.hooks || {};
const newHooks = JSON.parse(\`$HOOKS_JSON\`);
for (const [event, config] of Object.entries(newHooks)) {
  s.hooks[event] = s.hooks[event] || [];
  // Remove any existing clawlens hooks
  s.hooks[event] = s.hooks[event].filter(g => !JSON.stringify(g).includes('clawlens'));
  s.hooks[event].push(...config);
}
fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
"

echo "  -> $SETTINGS_FILE"

# ── Step 3: Verify server connectivity ────────────────────────────────────────

echo "[3/3] Verifying server connectivity..."
if curl -sf -m 5 "$SERVER_URL/health" >/dev/null 2>&1; then
  echo "  -> Server: OK ($SERVER_URL)"
else
  echo "  -> Server: UNREACHABLE ($SERVER_URL)"
  echo "     Check the URL and ensure the server is running."
  echo "     (Installation is complete — hooks will work once the server is available.)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ============================="
echo "  ClawLens installed!"
echo "  ============================="
echo ""
echo "  Hook script:  $HOOK_SCRIPT"
echo "  Settings:     $SETTINGS_FILE"
echo "  Server:       $SERVER_URL"
echo ""
echo "  Close ALL terminals, then open a fresh one and run: claude"
echo ""
