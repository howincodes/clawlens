#!/bin/bash
set -e

# ClawLens Deep Clean — remove ALL traces of ClawLens + old projects
# Usage: sudo bash deep-clean.sh
#
# Removes:
# - ClawLens standard install (hooks, watcher, cache, login agent)
# - ClawLens enforced mode (managed-settings.d, gate scripts)
# - Old claude-code-limiter managed settings
# - Old ClawLens v0.1 Go binary remnants
# - Old plugin registrations
# - Everything from settings.json (hooks, env vars)

echo ""
echo "  ClawLens Deep Clean"
echo "  ==================="
echo "  Removes ALL traces of ClawLens + old projects (limiter, v0.1, plugins)"
echo ""

# ── Detect OS ────────────────────────────────────────────────────────────────

OS=$(uname -s)
IS_ROOT=false
if [ "$(id -u)" -eq 0 ]; then IS_ROOT=true; fi

case "$OS" in
  Darwin)
    MANAGED_DIR="/Library/Application Support/ClaudeCode/managed-settings.d"
    GATE_DIR="/Library/Application Support/ClaudeCode"
    ;;
  Linux)
    MANAGED_DIR="/etc/claude-code/managed-settings.d"
    GATE_DIR="/etc/claude-code"
    ;;
esac

# ── Detect which user's home to clean ────────────────────────────────────────

if [ -n "$SUDO_USER" ]; then
  USER_HOME=$(eval echo "~$SUDO_USER")
  echo "  Running as root for user: $SUDO_USER ($USER_HOME)"
elif [ -n "$HOME" ]; then
  USER_HOME="$HOME"
  echo "  Running as: $(whoami) ($USER_HOME)"
fi

HOOK_DIR="$USER_HOME/.claude/hooks"
SETTINGS_FILE="$USER_HOME/.claude/settings.json"

echo ""

# ══════════════════════════════════════════════════════════════════════════════
# 1. Stop watcher process
# ══════════════════════════════════════════════════════════════════════════════

echo "  [1/8] Stopping watcher..."
PID_FILE="$HOOK_DIR/.clawlens-watcher.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    echo "    Stopped watcher (pid $PID)"
  fi
  rm -f "$PID_FILE"
fi
pkill -f "clawlens-watcher.mjs" 2>/dev/null || true
echo "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 2. Remove login agent / autostart
# ══════════════════════════════════════════════════════════════════════════════

echo "  [2/8] Removing auto-start entries..."
case "$OS" in
  Darwin)
    # ClawLens watcher
    launchctl bootout "gui/$(id -u "$SUDO_USER" 2>/dev/null || id -u)/com.clawlens.watcher" 2>/dev/null || true
    rm -f "$USER_HOME/Library/LaunchAgents/com.clawlens.watcher.plist"
    # Old claude-code-limiter
    launchctl bootout "gui/$(id -u "$SUDO_USER" 2>/dev/null || id -u)/com.claude-code-limiter.watcher" 2>/dev/null || true
    rm -f "$USER_HOME/Library/LaunchAgents/com.claude-code-limiter.watcher.plist"
    echo "    Removed macOS launch agents"
    ;;
  Linux)
    rm -f "$USER_HOME/.config/autostart/clawlens-watcher.desktop"
    rm -f "$USER_HOME/.config/autostart/claude-code-limiter.desktop"
    echo "    Removed Linux autostart entries"
    ;;
esac

# ══════════════════════════════════════════════════════════════════════════════
# 3. Remove hook files + Antigravity collector
# ══════════════════════════════════════════════════════════════════════════════

echo "  [3/8] Removing hook files..."
rm -f "$HOOK_DIR/clawlens.mjs"
rm -f "$HOOK_DIR/clawlens-watcher.mjs"
rm -f "$HOOK_DIR/clawlens-hook.sh"
rm -f "$HOOK_DIR/antigravity-collector.mjs"
# Old limiter files
rm -f "$HOOK_DIR/hook.js"
rm -f "$HOOK_DIR/limiter-hook.sh"
echo "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 4. Remove cache and log files
# ══════════════════════════════════════════════════════════════════════════════

echo "  [4/8] Removing cache and log files..."
rm -f "$HOOK_DIR/.clawlens-cache.json"
rm -f "$HOOK_DIR/.clawlens-model.txt"
rm -f "$HOOK_DIR/.clawlens-config.json"
rm -f "$HOOK_DIR/.clawlens-watcher.pid"
rm -f "$HOOK_DIR/.clawlens-debug.log"
rm -f "$HOOK_DIR/.clawlens-watcher.log"
rm -f "$HOOK_DIR/.clawlens-watcher-stderr.log"
rm -f "$HOOK_DIR/.clawlens-notify.ps1"
rm -f "$HOOK_DIR/.clawlens-notify-launcher.ps1"
rm -f "$HOOK_DIR/.clawlens-ag-last-sync.json"
rm -rf "$HOOK_DIR/.clawlens-ag-export"
# Old limiter cache
rm -f "$HOOK_DIR/.limiter-cache.json"
rm -f "$HOOK_DIR/.limiter-config.json"
echo "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 5. Clean settings.json (remove hooks + env vars)
# ══════════════════════════════════════════════════════════════════════════════

echo "  [5/8] Cleaning settings.json..."
if [ -f "$SETTINGS_FILE" ]; then
  node -e "
    const fs = require('fs');
    const f = '$SETTINGS_FILE';
    let s = {};
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { process.exit(0); }

    // Remove clawlens + limiter hooks
    if (s.hooks) {
      for (const [event, groups] of Object.entries(s.hooks)) {
        s.hooks[event] = groups.filter(g => {
          const str = JSON.stringify(g);
          return !str.includes('clawlens') && !str.includes('limiter');
        });
        if (s.hooks[event].length === 0) delete s.hooks[event];
      }
      if (Object.keys(s.hooks).length === 0) delete s.hooks;
    }

    // Remove clawlens + limiter env vars
    if (s.env) {
      const keysToRemove = [
        'CLAUDE_PLUGIN_OPTION_SERVER_URL',
        'CLAUDE_PLUGIN_OPTION_AUTH_TOKEN',
        'CLAWLENS_DEBUG',
        'CLAWLENS_SERVER',
        'CLAWLENS_TOKEN',
        'CLAUDE_LIMITER_SERVER',
        'CLAUDE_LIMITER_TOKEN',
      ];
      for (const key of keysToRemove) delete s.env[key];
      if (Object.keys(s.env).length === 0) delete s.env;
    }

    fs.writeFileSync(f, JSON.stringify(s, null, 2));
  " 2>/dev/null || echo "    Warning: could not clean settings.json"
  echo "    Done"
else
  echo "    No settings.json found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# 6. Remove managed settings (enforced mode) — requires root
# ══════════════════════════════════════════════════════════════════════════════

echo "  [6/8] Removing managed/enforced settings..."
if [ "$IS_ROOT" = true ] && [ -n "$MANAGED_DIR" ]; then
  # ClawLens
  rm -f "$MANAGED_DIR/10-clawlens.json"
  rm -f "$MANAGED_DIR/.10-clawlens.json.bak"
  rm -f "$MANAGED_DIR/.clawlens-hash"
  # Old limiter
  rm -f "$MANAGED_DIR/10-limiter.json"
  rm -f "$MANAGED_DIR/10-claude-code-limiter.json"
  # Old v0.1 (wrote directly to managed-settings.json)
  rm -f "$GATE_DIR/managed-settings.json"
  # Gate scripts
  rm -f "$GATE_DIR/clawlens-hook.sh"
  rm -f "$GATE_DIR/clawlens-gate.sh"
  rm -f "$GATE_DIR/limiter-hook.sh"
  rm -f "$GATE_DIR/limiter-gate.sh"
  # Clean empty dirs
  if [ -d "$MANAGED_DIR" ]; then
    REMAINING=$(ls -A "$MANAGED_DIR" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$REMAINING" = "0" ]; then
      rmdir "$MANAGED_DIR" 2>/dev/null || true
    fi
  fi
  echo "    Done"
else
  if [ -d "$MANAGED_DIR" ] 2>/dev/null; then
    echo "    Skipped (run with sudo to remove managed settings)"
  else
    echo "    No managed settings found"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# 7. Remove old Go binary + plugin registrations
# ══════════════════════════════════════════════════════════════════════════════

echo "  [7/8] Removing old binaries and plugins..."
# Old Go binaries
rm -f /usr/local/bin/clawlens 2>/dev/null || true
rm -f /usr/local/bin/claude-code-limiter 2>/dev/null || true
# Old config directories
rm -rf "$USER_HOME/.clawlens" 2>/dev/null || true
rm -rf "$USER_HOME/.claude-code-limiter" 2>/dev/null || true
# Old plugin uninstall
claude plugin uninstall clawlens@howincodes 2>/dev/null || true
claude plugin uninstall claude-code-limiter 2>/dev/null || true
echo "    Done"

# ══════════════════════════════════════════════════════════════════════════════
# 8. Verify
# ══════════════════════════════════════════════════════════════════════════════

echo "  [8/8] Verifying..."
REMAINING_HOOKS=$(find "$HOOK_DIR" -name "*clawlens*" -o -name "*limiter*" 2>/dev/null | head -5)
REMAINING_MANAGED=""
if [ "$IS_ROOT" = true ] && [ -n "$MANAGED_DIR" ]; then
  REMAINING_MANAGED=$(find "$MANAGED_DIR" -name "*clawlens*" -o -name "*limiter*" 2>/dev/null | head -5)
fi

echo ""
if [ -z "$REMAINING_HOOKS" ] && [ -z "$REMAINING_MANAGED" ]; then
  echo "  ✓ All ClawLens traces removed completely."
else
  echo "  ⚠ Some files remain:"
  [ -n "$REMAINING_HOOKS" ] && echo "$REMAINING_HOOKS"
  [ -n "$REMAINING_MANAGED" ] && echo "$REMAINING_MANAGED"
fi
echo ""
echo "  Restart Claude Code for changes to take effect."
echo ""
