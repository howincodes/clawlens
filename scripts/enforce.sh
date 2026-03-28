#!/bin/bash
set -e

# ClawLens Enforcement Installer — Managed Hooks with Gate
# Usage:
#   curl -fsSL <url>/enforce.sh | sudo bash
#   curl -fsSL <url>/enforce.sh | sudo bash -s -- --server URL --token TOKEN
#
# Enforced mode: Writes managed-settings.d with allowManagedHooksOnly + gate script
# with auth revocation on kill. Developers cannot override managed hooks.
#
# Requires: curl, node (or python3)

# ── Helpers ──────────────────────────────────────────────────────────────────

die() { echo "  ERROR: $*" >&2; exit 1; }

sha_cmd() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    die "Neither shasum nor sha256sum found. Cannot compute file hash."
  fi
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "This script must be run as root (use sudo)."
  fi
}

require_cmd() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
  done
}

# ── Parse arguments ──────────────────────────────────────────────────────────

SERVER_URL=""
AUTH_TOKEN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --server)    SERVER_URL="$2"; shift 2 ;;
    --token)     AUTH_TOKEN="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: sudo bash enforce.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --server URL     ClawLens server URL"
      echo "  --token TOKEN    Auth token for this team"
      echo "  -h, --help       Show this help"
      exit 0
      ;;
    *) shift ;;
  esac
done

# ── Pre-flight checks ───────────────────────────────────────────────────────

require_root
require_cmd curl

echo ""
echo "  ClawLens Enforcement Installer"
echo "  ================================"
echo ""

# ── Detect OS ────────────────────────────────────────────────────────────────

OS=$(uname -s)
case "$OS" in
  Darwin)
    MANAGED_DIR="/Library/Application Support/ClaudeCode/managed-settings.d"
    GATE_DIR="/Library/Application Support/ClaudeCode"
    ;;
  Linux)
    MANAGED_DIR="/etc/claude-code/managed-settings.d"
    GATE_DIR="/etc/claude-code"
    ;;
  *)
    die "Unsupported OS: $OS (use enforce.ps1 for Windows)"
    ;;
esac

# ── Prompt for config (if not passed via flags) ─────────────────────────────

if [ -z "$SERVER_URL" ]; then
  printf "  Server URL: "
  read -r SERVER_URL
fi
SERVER_URL="${SERVER_URL%/}"  # strip trailing slash

if [ -z "$AUTH_TOKEN" ]; then
  printf "  Auth token: "
  read -r AUTH_TOKEN
fi

[ -z "$SERVER_URL" ] && die "Server URL is required."
[ -z "$AUTH_TOKEN" ] && die "Auth token is required."

# Quick validation: URL must start with http(s)
case "$SERVER_URL" in
  http://*|https://*) ;;
  *) die "Server URL must start with http:// or https://" ;;
esac

# ── Check for existing installation ─────────────────────────────────────────

if [ -f "$MANAGED_DIR/10-clawlens.json" ]; then
  echo "  WARNING: Existing ClawLens enforcement found."
  printf "  Overwrite? (y/n) "
  read -r OVERWRITE
  case "$OVERWRITE" in
    y|Y) echo "  -> Overwriting existing installation." ;;
    *)   echo "  Aborted."; exit 0 ;;
  esac
  echo ""
fi

# ── Step 1: Create managed settings ─────────────────────────────────────────

echo "[1/2] Installing managed hooks + gate script..."

mkdir -p "$MANAGED_DIR" || die "Failed to create $MANAGED_DIR"
mkdir -p "$GATE_DIR"    || die "Failed to create $GATE_DIR"

# ── Install gate script (auth revocation on kill) ────────────────────────────

GATE_SCRIPT="$GATE_DIR/clawlens-gate.sh"
cat > "$GATE_SCRIPT" << 'GATEOF'
#!/bin/bash
# ClawLens gate — blocks killed/paused users at session start
INPUT=$(cat)
SERVER_URL="${CLAWLENS_SERVER:-${CLAUDE_PLUGIN_OPTION_SERVER_URL}}"
AUTH_TOKEN="${CLAWLENS_TOKEN:-${CLAUDE_PLUGIN_OPTION_AUTH_TOKEN}}"

# Fail open if env vars missing
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then
  exit 0
fi

RESP=$(curl -sf -m 5 \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d "$INPUT" \
  "$SERVER_URL/api/v1/hook/session-start" 2>/dev/null) || exit 0

# Check if server blocked the session (killed/paused)
if echo "$RESP" | grep -q '"continue".*false'; then
  # Revoke Claude Code auth credentials
  claude auth logout >/dev/null 2>&1 &
fi

# Pass through server response (contains continue:false or {})
[ -n "$RESP" ] && echo "$RESP"
GATEOF
chmod 755 "$GATE_SCRIPT"
echo "  -> Gate script: $GATE_SCRIPT"

# ── Install hook script (universal handler) ──────────────────────────────────

HOOK_SCRIPT="$GATE_DIR/clawlens-hook.sh"
cat > "$HOOK_SCRIPT" << 'HOOKEOF'
#!/bin/bash
# ClawLens hook handler — universal for ALL hook events
TMPFILE=$(mktemp 2>/dev/null || echo "/tmp/clawlens-hook-$$")
cat > "$TMPFILE"
SERVER_URL="${CLAWLENS_SERVER:-${CLAUDE_PLUGIN_OPTION_SERVER_URL}}"
AUTH_TOKEN="${CLAWLENS_TOKEN:-${CLAUDE_PLUGIN_OPTION_AUTH_TOKEN}}"
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then rm -f "$TMPFILE"; exit 0; fi
if command -v jq >/dev/null 2>&1; then
  EVENT=$(jq -r '.hook_event_name // ""' < "$TMPFILE")
elif command -v node >/dev/null 2>&1; then
  EVENT=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).hook_event_name||'')}catch{console.log('')}})" < "$TMPFILE")
else
  EVENT=$(grep -o '"hook_event_name":"[^"]*"' "$TMPFILE" | head -1 | cut -d'"' -f4)
fi
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
  *)                  rm -f "$TMPFILE"; exit 0 ;;
esac
RESP=$(curl -sf -m 3 -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $AUTH_TOKEN" -d @"$TMPFILE" "$SERVER_URL/api/v1/hook/$PATH_SUFFIX" 2>/dev/null)
rm -f "$TMPFILE"
[ -n "$RESP" ] && echo "$RESP"
HOOKEOF
chmod 755 "$HOOK_SCRIPT"
echo "  -> Hook script: $HOOK_SCRIPT"

# ── Write 10-clawlens.json ──────────────────────────────────────────────────

SETTINGS_FILE="$MANAGED_DIR/10-clawlens.json"

cat > "$SETTINGS_FILE" << EOF
{
  "allowManagedHooksOnly": true,
  "env": {
    "CLAWLENS_SERVER": "$SERVER_URL",
    "CLAWLENS_TOKEN": "$AUTH_TOKEN"
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {"type": "command", "command": "$GATE_SCRIPT", "timeout": 5}
        ]
      }
    ],
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 3}]}
    ],
    "PreToolUse": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 2, "async": true}]}
    ],
    "Stop": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 3}]}
    ],
    "StopFailure": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 2, "async": true}]}
    ],
    "SessionEnd": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 3, "async": true}]}
    ],
    "PostToolUse": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 3, "async": true}]}
    ],
    "SubagentStart": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 2, "async": true}]}
    ],
    "PostToolUseFailure": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 2, "async": true}]}
    ],
    "ConfigChange": [
      {"hooks": [{"type": "command", "command": "$HOOK_SCRIPT", "timeout": 3}]}
    ],
    "FileChanged": [
      {
        "matcher": "settings.json",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_SCRIPT",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
EOF

chmod 644 "$SETTINGS_FILE"
echo "  -> $SETTINGS_FILE"

# ── Validate the JSON we just wrote ─────────────────────────────────────────

if command -v node >/dev/null 2>&1; then
  if ! node -e "JSON.parse(require('fs').readFileSync('$SETTINGS_FILE','utf8'))" 2>/dev/null; then
    die "Generated JSON is invalid. This is a bug — please report it."
  fi
elif command -v python3 >/dev/null 2>&1; then
  if ! python3 -c "import json; json.load(open('$SETTINGS_FILE'))" 2>/dev/null; then
    die "Generated JSON is invalid. This is a bug — please report it."
  fi
fi

# ── Step 2: Save integrity hash (for reference) ──────────────────────────────

echo ""
echo "[2/2] Saving integrity hash..."

HASH=$(sha_cmd "$SETTINGS_FILE")
echo "$HASH" > "$MANAGED_DIR/.clawlens-hash"

# Keep a backup for reference
cp "$SETTINGS_FILE" "$MANAGED_DIR/.10-clawlens.json.bak"
chmod 644 "$MANAGED_DIR/.clawlens-hash"
chmod 644 "$MANAGED_DIR/.10-clawlens.json.bak"

echo "  -> Hash: $HASH"

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ====================================="
echo "  ClawLens enforcement installed!"
echo "  ====================================="
echo ""
echo "  Managed settings:  $MANAGED_DIR/10-clawlens.json"
echo "  Gate script:       $GATE_SCRIPT"
echo "  Kill/pause:        enabled (auth revocation on kill)"
echo ""
echo "  Developers CANNOT override these hooks (allowManagedHooksOnly = true)."
echo ""
echo "  Close ALL terminals, then open a fresh one and run: claude"
echo ""
