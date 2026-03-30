#!/bin/bash
set -e

# ClawLens Installer — one-command setup for Claude Code hooks
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/howincodes/clawlens/main/scripts/install.sh)
#
# This script:
# 1. Checks for claude CLI and Node.js
# 2. Prompts for server URL and auth token
# 3. Installs the Node.js hook handler to ~/.claude/hooks/clawlens.mjs
# 4. Creates a thin bash wrapper at ~/.claude/hooks/clawlens-hook.sh
# 5. Writes hook configuration into ~/.claude/settings.json (merging, not overwriting)
# 6. Sets env vars in settings.json
# 7. Verifies server connectivity

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

# Verify Node.js version >= 18 (needed for native fetch)
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
  echo "  Error: Node.js 18+ required (found v${NODE_MAJOR})."
  echo "  Update Node.js: https://nodejs.org/"
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

# ── Step 1: Install Node.js hook handler ────────────────────────────────────

echo "[1/4] Installing hook handler..."

HOOK_DIR="$HOME/.claude/hooks"
MJS_FILE="$HOOK_DIR/clawlens.mjs"
HOOK_SCRIPT="$HOOK_DIR/clawlens-hook.sh"
mkdir -p "$HOOK_DIR"

# Download the Node.js hook handler (zero dependencies, Node 18+)
# Try local copy first (if running from cloned repo), then download from GitHub
INSTALL_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
if [ -f "$INSTALL_SCRIPT_DIR/../client/clawlens.mjs" ]; then
  cp "$INSTALL_SCRIPT_DIR/../client/clawlens.mjs" "$MJS_FILE"
else
  CACHE_BUST="$(date +%s)"
  curl -fsSL "https://raw.githubusercontent.com/howincodes/clawlens/main/client/clawlens.mjs?v=$CACHE_BUST" -H "Cache-Control: no-cache" -o "$MJS_FILE" || \
    { echo "  ERROR: Could not download clawlens.mjs"; exit 1; }
fi

chmod 644 "$MJS_FILE"
echo "  -> $MJS_FILE"

# Install watcher
WATCHER_FILE="$HOOK_DIR/clawlens-watcher.mjs"
if [ -f "$INSTALL_SCRIPT_DIR/../client/clawlens-watcher.mjs" ]; then
  cp "$INSTALL_SCRIPT_DIR/../client/clawlens-watcher.mjs" "$WATCHER_FILE"
else
  CACHE_BUST="$(date +%s)"
  curl -fsSL "https://raw.githubusercontent.com/howincodes/clawlens/main/client/clawlens-watcher.mjs?v=$CACHE_BUST" -H "Cache-Control: no-cache" -o "$WATCHER_FILE" || \
    { echo "  ERROR: Could not download clawlens-watcher.mjs"; exit 1; }
fi
chmod 644 "$WATCHER_FILE"
echo "  -> $WATCHER_FILE (watcher)"

# Install Antigravity collector (built-in, no Python needed)
AG_COLLECTOR="$HOOK_DIR/antigravity-collector.mjs"
if [ -f "$INSTALL_SCRIPT_DIR/../client/antigravity-collector.mjs" ]; then
  cp "$INSTALL_SCRIPT_DIR/../client/antigravity-collector.mjs" "$AG_COLLECTOR"
else
  CACHE_BUST="$(date +%s)"
  curl -fsSL "https://raw.githubusercontent.com/howincodes/clawlens/main/client/antigravity-collector.mjs?v=$CACHE_BUST" -H "Cache-Control: no-cache" -o "$AG_COLLECTOR" 2>/dev/null || true
fi
if [ -f "$AG_COLLECTOR" ]; then
  chmod 644 "$AG_COLLECTOR"
  echo "  -> $AG_COLLECTOR (Antigravity collector)"
fi

# Write the thin bash wrapper (calls Node.js handler, fails open)
cat > "$HOOK_SCRIPT" << 'HOOKEOF'
#!/bin/bash
# ClawLens hook — thin wrapper that calls Node.js handler
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/clawlens.mjs" 2>/dev/null || exit 0
HOOKEOF

chmod 755 "$HOOK_SCRIPT"
echo "  -> $HOOK_SCRIPT"

# ── Step 2: Configure settings.json ──────────────────────────────────────────

echo "[2/4] Configuring hooks in settings.json..."

SETTINGS_FILE="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"

# Hook configuration JSON (uses absolute path via ~ expansion)
HOOKS_JSON=$(cat << 'HJEOF'
{
  "SessionStart": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10}]}],
  "UserPromptSubmit": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10}]}],
  "PreToolUse": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10, "async": true}]}],
  "Stop": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10}]}],
  "StopFailure": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10, "async": true}]}],
  "SessionEnd": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10, "async": true}]}],
  "PostToolUse": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10, "async": true}]}],
  "SubagentStart": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10, "async": true}]}],
  "PostToolUseFailure": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10, "async": true}]}],
  "ConfigChange": [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10}]}],
  "FileChanged": [{"matcher": "settings.json", "hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 10}]}]
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

echo "[3/4] Verifying server connectivity..."
if curl -sf -m 5 "$SERVER_URL/health" >/dev/null 2>&1; then
  echo "  -> Server: OK ($SERVER_URL)"
else
  echo "  -> Server: UNREACHABLE ($SERVER_URL)"
  echo "     Check the URL and ensure the server is running."
  echo "     (Installation is complete — hooks will work once the server is available.)"
fi

# ── Step: Setup watcher auto-start ──────────────────────────────────────────

echo "[4/4] Setting up watcher auto-start..."

NODE_PATH="$(which node)"

case "$(uname)" in
  Darwin)
    PLIST_DIR="$HOME/Library/LaunchAgents"
    PLIST_FILE="$PLIST_DIR/com.clawlens.watcher.plist"
    mkdir -p "$PLIST_DIR"
    cat > "$PLIST_FILE" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clawlens.watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_PATH</string>
    <string>$WATCHER_FILE</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$HOOK_DIR/.clawlens-watcher-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLAUDE_PLUGIN_OPTION_SERVER_URL</key><string>$SERVER_URL</string>
    <key>CLAUDE_PLUGIN_OPTION_AUTH_TOKEN</key><string>$AUTH_TOKEN</string>
  </dict>
</dict>
</plist>
PLISTEOF
    launchctl bootout "gui/$(id -u)/com.clawlens.watcher" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
    echo "  -> macOS login agent: $PLIST_FILE"
    ;;
  Linux)
    AUTOSTART_DIR="$HOME/.config/autostart"
    DESKTOP_FILE="$AUTOSTART_DIR/clawlens-watcher.desktop"
    mkdir -p "$AUTOSTART_DIR"
    cat > "$DESKTOP_FILE" << DESKTOPEOF
[Desktop Entry]
Type=Application
Name=ClawLens Watcher
Exec=/bin/bash -c 'CLAUDE_PLUGIN_OPTION_SERVER_URL="$SERVER_URL" CLAUDE_PLUGIN_OPTION_AUTH_TOKEN="$AUTH_TOKEN" $NODE_PATH $WATCHER_FILE'
Hidden=true
X-GNOME-Autostart-enabled=true
DESKTOPEOF
    echo "  -> Linux autostart: $DESKTOP_FILE"
    ;;
esac

# Start watcher now
echo "  Starting watcher..."
CLAUDE_PLUGIN_OPTION_SERVER_URL="$SERVER_URL" CLAUDE_PLUGIN_OPTION_AUTH_TOKEN="$AUTH_TOKEN" nohup "$NODE_PATH" "$WATCHER_FILE" > /dev/null 2>&1 &
echo "  -> Watcher running (pid $!)"

# ── Optional: Antigravity IDE integration ────────────────────────────────────

if command -v python3 >/dev/null 2>&1; then
  PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
  PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
  PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
  if [ "$PY_MAJOR" -ge 3 ] 2>/dev/null && [ "$PY_MINOR" -ge 9 ] 2>/dev/null; then
    echo ""
    printf "  Do you use Google Antigravity IDE? (y/n): "
    read -r USE_AG
    if [ "$USE_AG" = "y" ] || [ "$USE_AG" = "Y" ]; then
      echo "  Installing Antigravity integration..."
      pip3 install antigravity-history --quiet 2>/dev/null || pip install antigravity-history --quiet 2>/dev/null || true
      echo "  -> Antigravity collection enabled (prompts will be tracked automatically)"
    fi
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ============================="
echo "  ClawLens installed!"
echo "  ============================="
echo ""
echo "  Hook handler: $MJS_FILE"
echo "  Hook wrapper: $HOOK_SCRIPT"
echo "  Watcher:      $WATCHER_FILE"
echo "  Settings:     $SETTINGS_FILE"
echo "  Server:       $SERVER_URL"
echo ""
echo "  Close ALL terminals, then open a fresh one and run: claude"
echo ""
