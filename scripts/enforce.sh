#!/bin/bash
set -e

# ClawLens Enforcement Installer — Tier 2/3 Managed Hooks
# Usage:
#   Tier 2: curl -fsSL <url>/enforce.sh | sudo bash
#   Tier 3: curl -fsSL <url>/enforce.sh | sudo bash -s -- --tier3
#
# Tier 2: All hooks fire to server. Developers cannot override managed hooks.
# Tier 3: Same as Tier 2, plus a gate script on SessionStart that can
#          revoke access (kill/pause) in real time.
#
# Requires: curl, python3, shasum (macOS) or sha256sum (Linux)

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

TIER="tier2"
SERVER_URL=""
AUTH_TOKEN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tier3)     TIER="tier3"; shift ;;
    --server)    SERVER_URL="$2"; shift 2 ;;
    --token)     AUTH_TOKEN="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: sudo bash enforce.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --tier3          Enable Tier 3 (gate script with kill/pause)"
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
require_cmd curl python3

echo ""
echo "  ClawLens Enforcement Installer"
echo "  ================================"
echo "  Tier: $TIER"
echo ""

# ── Detect OS ────────────────────────────────────────────────────────────────

OS=$(uname -s)
case "$OS" in
  Darwin)
    MANAGED_DIR="/Library/Application Support/ClaudeCode/managed-settings.d"
    GATE_DIR="/Library/Application Support/ClaudeCode"
    LOG_DIR="/var/log"
    ;;
  Linux)
    MANAGED_DIR="/etc/claude-code/managed-settings.d"
    GATE_DIR="/etc/claude-code"
    LOG_DIR="/var/log"
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

echo "[1/3] Installing managed hooks..."

mkdir -p "$MANAGED_DIR" || die "Failed to create $MANAGED_DIR"
mkdir -p "$GATE_DIR"    || die "Failed to create $GATE_DIR"

# ── Install hook/gate scripts ────────────────────────────────────────────────

if [ "$TIER" = "tier3" ]; then
  # Tier 3 gate script: can block session start for killed/paused users
  GATE_SCRIPT="$GATE_DIR/clawlens-gate.sh"
  cat > "$GATE_SCRIPT" << 'GATEOF'
#!/bin/bash
# ClawLens Tier 3 gate — blocks killed/paused users at session start
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
  # Tier 3: revoke Claude Code auth credentials
  claude auth logout >/dev/null 2>&1 &
fi

# Pass through server response (contains continue:false or {})
[ -n "$RESP" ] && echo "$RESP"
GATEOF
  chmod 755 "$GATE_SCRIPT"
  echo "  -> Gate script: $GATE_SCRIPT"
  SESSION_START_HOOK="\"type\": \"command\", \"command\": \"$GATE_SCRIPT\", \"timeout\": 5"
else
  # Tier 2 command hook: fires session-start and file-changed events
  HOOK_SCRIPT="$GATE_DIR/clawlens-hook.sh"
  cat > "$HOOK_SCRIPT" << 'HOOKEOF'
#!/bin/bash
# ClawLens hook handler — universal for ALL hook events
INPUT=$(cat)
SERVER_URL="${CLAWLENS_SERVER:-${CLAUDE_PLUGIN_OPTION_SERVER_URL}}"
AUTH_TOKEN="${CLAWLENS_TOKEN:-${CLAUDE_PLUGIN_OPTION_AUTH_TOKEN}}"
if [ -z "$SERVER_URL" ] || [ -z "$AUTH_TOKEN" ]; then exit 0; fi
if command -v jq >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // ""')
elif command -v node >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).hook_event_name||'')}catch{console.log('')}})")
elif command -v python3 >/dev/null 2>&1; then
  EVENT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null)
else
  EVENT=""
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
  *)                  exit 0 ;;
esac
RESP=$(curl -sf -m 5 -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $AUTH_TOKEN" -d "$INPUT" "$SERVER_URL/api/v1/hook/$PATH_SUFFIX" 2>/dev/null)
[ -n "$RESP" ] && echo "$RESP"
HOOKEOF
  chmod 755 "$HOOK_SCRIPT"
  echo "  -> Hook script: $HOOK_SCRIPT"
  SESSION_START_HOOK="\"type\": \"command\", \"command\": \"$HOOK_SCRIPT\", \"timeout\": 5"
fi

# ── Determine which command script to use for FileChanged ────────────────────

if [ "$TIER" = "tier3" ]; then
  FILE_CHANGED_CMD="$GATE_DIR/clawlens-gate.sh"
else
  FILE_CHANGED_CMD="$GATE_DIR/clawlens-hook.sh"
fi

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
          {$SESSION_START_HOOK}
        ]
      }
    ],
    "UserPromptSubmit": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 5}]}
    ],
    "PreToolUse": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 2}]}
    ],
    "Stop": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 5}]}
    ],
    "StopFailure": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 2, "async": true}]}
    ],
    "SessionEnd": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 3, "async": true}]}
    ],
    "PostToolUse": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 3, "async": true}]}
    ],
    "SubagentStart": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 2, "async": true}]}
    ],
    "PostToolUseFailure": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 2, "async": true}]}
    ],
    "ConfigChange": [
      {"hooks": [{"type": "command", "command": "$GATE_DIR/clawlens-hook.sh", "timeout": 3}]}
    ],
    "FileChanged": [
      {
        "matcher": "settings.json",
        "hooks": [
          {
            "type": "command",
            "command": "$FILE_CHANGED_CMD",
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

if ! python3 -c "import json; json.load(open('$SETTINGS_FILE'))" 2>/dev/null; then
  die "Generated JSON is invalid. This is a bug — please report it."
fi

# ── Step 2: Save integrity hash ─────────────────────────────────────────────

echo ""
echo "[2/3] Saving integrity hash..."

HASH=$(sha_cmd "$SETTINGS_FILE")
echo "$HASH" > "$MANAGED_DIR/.clawlens-hash"

# Keep a backup for the watchdog to restore from
cp "$SETTINGS_FILE" "$MANAGED_DIR/.10-clawlens.json.bak"
chmod 644 "$MANAGED_DIR/.clawlens-hash"
chmod 644 "$MANAGED_DIR/.10-clawlens.json.bak"

echo "  -> Hash: $HASH"

# ── Step 3: Install watchdog daemon ──────────────────────────────────────────

echo ""
echo "[3/3] Installing watchdog daemon..."

# Create the log file with correct permissions
touch "$LOG_DIR/clawlens-watchdog.log" 2>/dev/null || true
chmod 644 "$LOG_DIR/clawlens-watchdog.log" 2>/dev/null || true

WATCHDOG_SCRIPT="$GATE_DIR/clawlens-watchdog.sh"
cat > "$WATCHDOG_SCRIPT" << WDEOF
#!/bin/bash
# ClawLens Watchdog — auto-repair tampered managed settings
# Runs every 5 minutes via launchd (macOS) or systemd (Linux)

MANAGED_FILE="$MANAGED_DIR/10-clawlens.json"
HASH_FILE="$MANAGED_DIR/.clawlens-hash"
BACKUP_FILE="$MANAGED_DIR/.10-clawlens.json.bak"
LOG_FILE="$LOG_DIR/clawlens-watchdog.log"

log() {
  echo "\$(date '+%Y-%m-%d %H:%M:%S'): \$1" >> "\$LOG_FILE"
}

# Rotate log if > 1MB
if [ -f "\$LOG_FILE" ]; then
  LOG_SIZE=\$(wc -c < "\$LOG_FILE" 2>/dev/null || echo 0)
  if [ "\$LOG_SIZE" -gt 1048576 ]; then
    mv "\$LOG_FILE" "\$LOG_FILE.old" 2>/dev/null
    log "Log rotated"
  fi
fi

# Check backup exists
if [ ! -f "\$BACKUP_FILE" ]; then
  log "ERROR — backup file missing, cannot restore"
  exit 1
fi

# Case 1: managed settings file deleted
if [ ! -f "\$MANAGED_FILE" ]; then
  log "RESTORED — managed settings file was missing"
  cp "\$BACKUP_FILE" "\$MANAGED_FILE"
  chmod 644 "\$MANAGED_FILE"
  exit 0
fi

# Case 2: managed settings file modified (hash mismatch)
EXPECTED_HASH=\$(cat "\$HASH_FILE" 2>/dev/null)
if [ -z "\$EXPECTED_HASH" ]; then
  log "ERROR — hash file missing or empty, cannot verify integrity"
  exit 1
fi

# Compute current hash (support both macOS and Linux)
if command -v shasum >/dev/null 2>&1; then
  CURRENT_HASH=\$(shasum -a 256 "\$MANAGED_FILE" 2>/dev/null | awk '{print \$1}')
elif command -v sha256sum >/dev/null 2>&1; then
  CURRENT_HASH=\$(sha256sum "\$MANAGED_FILE" 2>/dev/null | awk '{print \$1}')
else
  log "ERROR — no sha256 command available"
  exit 1
fi

if [ "\$CURRENT_HASH" != "\$EXPECTED_HASH" ]; then
  log "RESTORED — managed settings were modified (expected \$EXPECTED_HASH, got \$CURRENT_HASH)"
  cp "\$BACKUP_FILE" "\$MANAGED_FILE"
  chmod 644 "\$MANAGED_FILE"
fi
WDEOF
chmod 755 "$WATCHDOG_SCRIPT"
echo "  -> Watchdog script: $WATCHDOG_SCRIPT"

if [ "$OS" = "Darwin" ]; then
  # ── macOS: LaunchDaemon ────────────────────────────────────────────────────
  PLIST="/Library/LaunchDaemons/com.clawlens.watchdog.plist"

  # Unload existing if present (ignore errors)
  launchctl unload "$PLIST" 2>/dev/null || true

  cat > "$PLIST" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.clawlens.watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WATCHDOG_SCRIPT</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/clawlens-watchdog-stderr.log</string>
</dict>
</plist>
PLISTEOF

  chmod 644 "$PLIST"
  launchctl load "$PLIST" 2>/dev/null || echo "  WARNING: Failed to load LaunchDaemon. Load manually: sudo launchctl load $PLIST"
  echo "  -> Installed LaunchDaemon: com.clawlens.watchdog (every 5 min)"

else
  # ── Linux: systemd timer ───────────────────────────────────────────────────
  SVC_FILE="/etc/systemd/system/clawlens-watchdog.service"
  TMR_FILE="/etc/systemd/system/clawlens-watchdog.timer"

  cat > "$SVC_FILE" << SVCEOF
[Unit]
Description=ClawLens Watchdog — auto-repair managed settings

[Service]
Type=oneshot
ExecStart=/bin/bash $WATCHDOG_SCRIPT
SVCEOF

  cat > "$TMR_FILE" << TMREOF
[Unit]
Description=ClawLens Watchdog Timer (every 5 min)

[Timer]
OnBootSec=60
OnUnitActiveSec=300

[Install]
WantedBy=timers.target
TMREOF

  chmod 644 "$SVC_FILE" "$TMR_FILE"
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable clawlens-watchdog.timer 2>/dev/null || true
  systemctl start clawlens-watchdog.timer 2>/dev/null || true
  echo "  -> Installed systemd timer: clawlens-watchdog (every 5 min)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ====================================="
echo "  ClawLens enforcement installed! ($TIER)"
echo "  ====================================="
echo ""
echo "  Managed settings:  $MANAGED_DIR/10-clawlens.json"
echo "  Watchdog:          active (every 5 min)"
if [ "$TIER" = "tier3" ]; then
  echo "  Gate script:       $GATE_DIR/clawlens-gate.sh"
  echo "  Kill/pause:        enabled (auth revocation on kill)"
fi
echo ""
echo "  Developers CANNOT override these hooks (allowManagedHooksOnly = true)."
echo "  The watchdog will auto-restore settings if tampered with."
echo ""
echo "  Close ALL terminals, then open a fresh one and run: claude"
echo ""
