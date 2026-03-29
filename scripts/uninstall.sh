#!/bin/bash
set -e

echo ""
echo "  ClawLens Uninstaller"
echo "  ===================="
echo ""

HOOK_DIR="$HOME/.claude/hooks"
SETTINGS_FILE="$HOME/.claude/settings.json"

# 1. Stop watcher process
echo "  Stopping watcher..."
PID_FILE="$HOOK_DIR/.clawlens-watcher.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    echo "  -> Stopped watcher (pid $PID)"
  fi
  rm -f "$PID_FILE"
fi
# Also kill by process name as fallback
pkill -f "clawlens-watcher.mjs" 2>/dev/null || true

# 2. Remove login agent
echo "  Removing auto-start..."
case "$(uname)" in
  Darwin)
    launchctl bootout "gui/$(id -u)/com.clawlens.watcher" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.clawlens.watcher.plist"
    echo "  -> Removed macOS login agent"
    ;;
  Linux)
    rm -f "$HOME/.config/autostart/clawlens-watcher.desktop"
    echo "  -> Removed Linux autostart entry"
    ;;
esac

# 3. Remove hook files
echo "  Removing hook files..."
rm -f "$HOOK_DIR/clawlens.mjs"
rm -f "$HOOK_DIR/clawlens-watcher.mjs"
rm -f "$HOOK_DIR/clawlens-hook.sh"
echo "  -> Removed clawlens.mjs, clawlens-watcher.mjs, clawlens-hook.sh"

# 4. Remove cache and log files
echo "  Removing cache and log files..."
rm -f "$HOOK_DIR/.clawlens-cache.json"
rm -f "$HOOK_DIR/.clawlens-model.txt"
rm -f "$HOOK_DIR/.clawlens-config.json"
rm -f "$HOOK_DIR/.clawlens-watcher.pid"
rm -f "$HOOK_DIR/.clawlens-debug.log"
rm -f "$HOOK_DIR/.clawlens-watcher.log"
rm -f "$HOOK_DIR/.clawlens-watcher-stderr.log"
rm -f "$HOOK_DIR/.clawlens-notify.ps1"
echo "  -> Removed all cache and log files"

# 5. Remove ClawLens hooks and env vars from settings.json
if [ -f "$SETTINGS_FILE" ]; then
  echo "  Cleaning settings.json..."
  node -e "
    const fs = require('fs');
    const f = '$SETTINGS_FILE';
    let s = {};
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { process.exit(0); }

    // Remove clawlens hooks
    if (s.hooks) {
      for (const [event, groups] of Object.entries(s.hooks)) {
        s.hooks[event] = groups.filter(g => !JSON.stringify(g).includes('clawlens'));
        if (s.hooks[event].length === 0) delete s.hooks[event];
      }
      if (Object.keys(s.hooks).length === 0) delete s.hooks;
    }

    // Remove clawlens env vars
    if (s.env) {
      delete s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
      delete s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN;
      delete s.env.CLAWLENS_DEBUG;
      if (Object.keys(s.env).length === 0) delete s.env;
    }

    fs.writeFileSync(f, JSON.stringify(s, null, 2));
  " 2>/dev/null || echo "  -> Warning: could not clean settings.json (manual cleanup may be needed)"
  echo "  -> Cleaned settings.json"
fi

# 6. Verify
echo ""
REMAINING=$(find "$HOOK_DIR" -name "*clawlens*" 2>/dev/null | head -5)
if [ -z "$REMAINING" ]; then
  echo "  ============================="
  echo "  ClawLens removed completely."
  echo "  ============================="
else
  echo "  WARNING: Some ClawLens files remain:"
  echo "$REMAINING"
fi
echo ""
