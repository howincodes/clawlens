#!/bin/bash
set -e

# ClawLens Enforcement Removal — clean uninstall
# Usage: sudo bash restore.sh
#
# Removes all managed settings, hook/gate scripts, watchdog daemon,
# and log files installed by enforce.sh.

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
    PLIST="/Library/LaunchDaemons/com.clawlens.watchdog.plist"

    # Stop and unload watchdog LaunchDaemon
    if [ -f "$PLIST" ]; then
      launchctl unload "$PLIST" 2>/dev/null || true
      rm -f "$PLIST"
      echo "  -> Removed LaunchDaemon: com.clawlens.watchdog"
    else
      echo "  -> LaunchDaemon not found (already removed or never installed)"
    fi
    ;;
  Linux)
    MANAGED_DIR="/etc/claude-code/managed-settings.d"
    GATE_DIR="/etc/claude-code"

    # Stop and disable watchdog systemd timer
    if systemctl is-active clawlens-watchdog.timer >/dev/null 2>&1; then
      systemctl stop clawlens-watchdog.timer 2>/dev/null || true
    fi
    systemctl disable clawlens-watchdog.timer 2>/dev/null || true
    rm -f /etc/systemd/system/clawlens-watchdog.service
    rm -f /etc/systemd/system/clawlens-watchdog.timer
    systemctl daemon-reload 2>/dev/null || true
    echo "  -> Removed systemd timer: clawlens-watchdog"
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
for SCRIPT in clawlens-hook.sh clawlens-gate.sh clawlens-watchdog.sh; do
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

# ── Remove log files ────────────────────────────────────────────────────────

rm -f /var/log/clawlens-watchdog.log
rm -f /var/log/clawlens-watchdog.log.old
rm -f /var/log/clawlens-watchdog-stderr.log
echo "  -> Removed log files"

# ── Optional: uninstall plugin ───────────────────────────────────────────────

echo ""
printf "  Also uninstall the ClawLens plugin? (y/n) "
read -r CHOICE
case "$CHOICE" in
  y|Y)
    if command -v claude >/dev/null 2>&1; then
      claude plugin uninstall clawlens 2>/dev/null && echo "  -> Plugin uninstalled" || echo "  -> Plugin not installed or uninstall failed"
    else
      echo "  -> claude command not found (skipping plugin removal)"
    fi
    ;;
  *)
    echo "  -> Skipped plugin removal"
    ;;
esac

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo "  ClawLens enforcement removed."
echo "  Restart Claude Code for changes to take effect."
echo ""
