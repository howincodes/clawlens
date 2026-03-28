#!/bin/bash
set -e

# ClawLens Uninstaller — removes hook script, hooks config, and env vars
# Usage: bash scripts/uninstall.sh

echo ""
echo "  ClawLens Uninstaller"
echo "  ====================="
echo ""

# ── Step 1: Remove hook script ───────────────────────────────────────────────

HOOK_SCRIPT="$HOME/.claude/hooks/clawlens-hook.sh"
if [ -f "$HOOK_SCRIPT" ]; then
  rm -f "$HOOK_SCRIPT"
  echo "  -> Removed hook script: $HOOK_SCRIPT"
else
  echo "  -> Hook script not found (already removed or never installed)"
fi

# Clean up empty hooks directory
HOOK_DIR="$HOME/.claude/hooks"
if [ -d "$HOOK_DIR" ]; then
  REMAINING=$(ls -A "$HOOK_DIR" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$REMAINING" = "0" ]; then
    rmdir "$HOOK_DIR" 2>/dev/null || true
    echo "  -> Removed empty directory: $HOOK_DIR"
  fi
fi

# ── Step 2: Remove clawlens hooks and env vars from settings.json ────────────

SETTINGS_FILE="$HOME/.claude/settings.json"

if [ -f "$SETTINGS_FILE" ]; then
  if command -v node >/dev/null 2>&1; then
    node -e "
const fs = require('fs');
const path = process.env.HOME + '/.claude/settings.json';
let s = {};
try { s = JSON.parse(fs.readFileSync(path, 'utf8')); } catch { process.exit(0); }

// Remove clawlens env vars
if (s.env) {
  delete s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
  delete s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN;
  if (Object.keys(s.env).length === 0) delete s.env;
}

// Remove clawlens hooks from each event
if (s.hooks) {
  for (const [event, groups] of Object.entries(s.hooks)) {
    if (Array.isArray(groups)) {
      s.hooks[event] = groups.filter(g => !JSON.stringify(g).includes('clawlens'));
      if (s.hooks[event].length === 0) delete s.hooks[event];
    }
  }
  if (Object.keys(s.hooks).length === 0) delete s.hooks;
}

fs.writeFileSync(path, JSON.stringify(s, null, 2));
"
    echo "  -> Cleaned settings.json: $SETTINGS_FILE"
  else
    echo "  -> WARNING: node not found — cannot clean settings.json automatically."
    echo "     Manually remove clawlens entries from $SETTINGS_FILE"
  fi
else
  echo "  -> settings.json not found (nothing to clean)"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ClawLens uninstalled."
echo "  Restart Claude Code for changes to take effect."
echo ""
