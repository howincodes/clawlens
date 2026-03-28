#!/bin/bash
set -e

# ClawLens Enforcement Removal — clean uninstall
# Usage: sudo bash restore.sh
#
# Removes all managed settings, hook/gate scripts, and backup files
# installed by enforce.sh.

# ── Helpers ──────────────────────────────────────────────────────────────────

die() { echo "  ERROR: $*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "This script must be run as root (use sudo)."
  fi
}

# ── Pre-flight ───────────────────────────────────────────────────────────────

require_root

echo ""
echo "  ClawLens Enforcement Removal"
echo "  =============================="
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
    die "Unsupported OS: $OS (use restore.ps1 for Windows)"
    ;;
esac

# ── Remove managed settings ─────────────────────────────────────────────────

REMOVED=0

if [ -f "$MANAGED_DIR/10-clawlens.json" ]; then
  rm -f "$MANAGED_DIR/10-clawlens.json"
  REMOVED=$((REMOVED + 1))
fi
rm -f "$MANAGED_DIR/.10-clawlens.json.bak"
rm -f "$MANAGED_DIR/.clawlens-hash"

if [ "$REMOVED" -gt 0 ]; then
  echo "  -> Removed managed settings"
else
  echo "  -> Managed settings not found (already removed or never installed)"
fi

# Check if managed-settings.d is now empty; if so, clean up
if [ -d "$MANAGED_DIR" ]; then
  REMAINING=$(ls -A "$MANAGED_DIR" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$REMAINING" = "0" ]; then
    rmdir "$MANAGED_DIR" 2>/dev/null || true
    echo "  -> Removed empty directory: $MANAGED_DIR"
  fi
fi

# ── Remove scripts ──────────────────────────────────────────────────────────

SCRIPTS_REMOVED=0
for SCRIPT in clawlens-hook.sh clawlens-gate.sh; do
  if [ -f "$GATE_DIR/$SCRIPT" ]; then
    rm -f "$GATE_DIR/$SCRIPT"
    SCRIPTS_REMOVED=$((SCRIPTS_REMOVED + 1))
  fi
done

if [ "$SCRIPTS_REMOVED" -gt 0 ]; then
  echo "  -> Removed $SCRIPTS_REMOVED script(s)"
else
  echo "  -> No scripts found to remove"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ClawLens enforcement removed."
echo "  Restart Claude Code for changes to take effect."
echo ""
