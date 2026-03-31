#!/bin/bash
# ClawLens Diagnostic Tool
# Run: bash scripts/debug.sh
# Shows status of all ClawLens components on this machine.

set -e

# ── Colors ────────────────────────────────────────────
G='\033[0;32m'  # green
Y='\033[0;33m'  # yellow
R='\033[0;31m'  # red
C='\033[0;36m'  # cyan
B='\033[1m'     # bold
D='\033[0m'     # reset

ok()   { echo -e "  ${G}✓${D} $1"; }
warn() { echo -e "  ${Y}⚠${D} $1"; }
fail() { echo -e "  ${R}✗${D} $1"; }
info() { echo -e "  ${C}→${D} $1"; }
hdr()  { echo -e "\n${B}$1${D}"; }

# ── Config ────────────────────────────────────────────
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
CLAUDE_HOOKS_DIR="$HOME/.claude/hooks"
CODEX_CONFIG="$HOME/.codex/config.toml"
CODEX_HOOKS_JSON="$HOME/.codex/hooks.json"
CODEX_HOOKS_DIR="$HOME/.codex/hooks"
CC_DEBUG_LOG="$CLAUDE_HOOKS_DIR/.clawlens-debug.log"
CODEX_DEBUG_LOG="$CODEX_HOOKS_DIR/.clawlens-codex-debug.log"
WATCHER_LOG="$CLAUDE_HOOKS_DIR/.clawlens-watcher.log"

echo ""
echo -e "${B}ClawLens Diagnostics${D}"
echo "===================="
echo "$(date)"

# ══════════════════════════════════════════════════════
hdr "1. Claude Code Hooks"
# ══════════════════════════════════════════════════════

if [ -f "$CLAUDE_SETTINGS" ]; then
  ok "settings.json exists"

  # Check if hooks are configured
  HOOK_COUNT=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$CLAUDE_SETTINGS', 'utf8'));
    const hooks = Object.keys(s.hooks || {}).filter(k => JSON.stringify(s.hooks[k]).includes('clawlens'));
    console.log(hooks.length);
  " 2>/dev/null || echo "0")

  if [ "$HOOK_COUNT" -gt 0 ]; then
    ok "ClawLens hooks: $HOOK_COUNT events configured"
  else
    fail "No ClawLens hooks in settings.json"
  fi

  # Check env vars
  SERVER_URL=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$CLAUDE_SETTINGS', 'utf8'));
    console.log(s.env?.CLAUDE_PLUGIN_OPTION_SERVER_URL || s.env?.CLAWLENS_SERVER || '');
  " 2>/dev/null || echo "")

  AUTH_TOKEN=$(node -e "
    const s = JSON.parse(require('fs').readFileSync('$CLAUDE_SETTINGS', 'utf8'));
    const t = s.env?.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN || s.env?.CLAWLENS_TOKEN || '';
    console.log(t ? t.slice(0,8) + '...' : '');
  " 2>/dev/null || echo "")

  if [ -n "$SERVER_URL" ]; then
    ok "Server URL: $SERVER_URL"
  else
    fail "No server URL in env"
  fi

  if [ -n "$AUTH_TOKEN" ]; then
    ok "Auth token: $AUTH_TOKEN"
  else
    fail "No auth token in env"
  fi
else
  fail "settings.json not found at $CLAUDE_SETTINGS"
fi

# Hook scripts
if [ -f "$CLAUDE_HOOKS_DIR/clawlens-hook.sh" ]; then
  ok "clawlens-hook.sh exists"
else
  fail "clawlens-hook.sh missing"
fi

if [ -f "$CLAUDE_HOOKS_DIR/clawlens.mjs" ]; then
  ok "clawlens.mjs exists"
else
  fail "clawlens.mjs missing"
fi

# ══════════════════════════════════════════════════════
hdr "2. OpenAI Codex Hooks"
# ══════════════════════════════════════════════════════

if command -v codex &>/dev/null; then
  CODEX_VER=$(codex --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  ok "Codex installed: v$CODEX_VER"

  if [ "$(echo "$CODEX_VER" | awk -F. '{print ($1*10000)+($2*100)+$3}')" -ge 1170 ]; then
    ok "Version ≥ 0.117.0 (hooks supported)"
  else
    warn "Version < 0.117.0 (hooks may not work)"
  fi
else
  warn "Codex not installed"
fi

if [ -f "$CODEX_CONFIG" ]; then
  ok "config.toml exists"
  if grep -q 'codex_hooks.*true' "$CODEX_CONFIG" 2>/dev/null; then
    ok "codex_hooks = true"
  else
    fail "codex_hooks not enabled in config.toml"
  fi
else
  warn "config.toml not found"
fi

if [ -f "$CODEX_HOOKS_JSON" ]; then
  ok "hooks.json exists"
  CODEX_HOOK_EVENTS=$(node -e "
    const h = JSON.parse(require('fs').readFileSync('$CODEX_HOOKS_JSON', 'utf8'));
    const events = Object.keys(h.hooks || h);
    console.log(events.length + ' events: ' + events.join(', '));
  " 2>/dev/null || echo "parse error")
  info "$CODEX_HOOK_EVENTS"
else
  warn "hooks.json not found at $CODEX_HOOKS_JSON"
fi

if [ -f "$CODEX_HOOKS_DIR/clawlens-codex.mjs" ]; then
  ok "clawlens-codex.mjs exists"
else
  warn "clawlens-codex.mjs missing"
fi

# Check Codex auth
if [ -f "$HOME/.codex/auth.json" ]; then
  CODEX_EMAIL=$(node -e "
    const a = JSON.parse(require('fs').readFileSync('$HOME/.codex/auth.json', 'utf8'));
    const jwt = a.tokens?.id_token;
    if (!jwt) { console.log('(no id_token)'); process.exit(); }
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    console.log(payload.email || '(no email)');
  " 2>/dev/null || echo "(parse error)")
  ok "auth.json: $CODEX_EMAIL"
else
  warn "auth.json not found (not logged in)"
fi

# ══════════════════════════════════════════════════════
hdr "3. Watcher"
# ══════════════════════════════════════════════════════

WATCHER_PID=$(pgrep -f "clawlens-watcher" 2>/dev/null | head -1)
if [ -n "$WATCHER_PID" ]; then
  ok "Watcher running (pid $WATCHER_PID)"
  WATCHER_UPTIME=$(ps -p "$WATCHER_PID" -o etime= 2>/dev/null | xargs)
  info "Uptime: $WATCHER_UPTIME"
else
  fail "Watcher NOT running"
fi

if [ -f "$CLAUDE_HOOKS_DIR/clawlens-watcher.mjs" ]; then
  ok "clawlens-watcher.mjs exists"
else
  fail "clawlens-watcher.mjs missing"
fi

# ══════════════════════════════════════════════════════
hdr "4. Antigravity Collector"
# ══════════════════════════════════════════════════════

if [ -f "$CLAUDE_HOOKS_DIR/antigravity-collector.mjs" ]; then
  ok "antigravity-collector.mjs exists"
else
  warn "antigravity-collector.mjs missing"
fi

# Check if Antigravity LS is running
AG_PID=""
case "$(uname -s)" in
  Darwin)
    AG_PID=$(pgrep -f "language_server_macos" 2>/dev/null | head -1)
    ;;
  Linux)
    AG_PID=$(pgrep -f "language_server_linux" 2>/dev/null | head -1)
    ;;
esac

if [ -n "$AG_PID" ]; then
  ok "Antigravity LS running (pid $AG_PID)"
else
  warn "Antigravity LS not running (IDE may be closed)"
fi

# ══════════════════════════════════════════════════════
hdr "5. Server Connectivity"
# ══════════════════════════════════════════════════════

# Get server URL from settings or codex hooks
if [ -z "$SERVER_URL" ]; then
  SERVER_URL=$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync('$CODEX_HOOKS_JSON', 'utf8'));
      const cmd = s.hooks?.SessionStart?.[0]?.hooks?.[0]?.command || '';
      const m = cmd.match(/CLAWLENS_SERVER=(\S+)/);
      if (m) console.log(m[1]);
    } catch {}
  " 2>/dev/null || echo "")
fi

if [ -n "$SERVER_URL" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$SERVER_URL/health" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    ok "Server reachable: $SERVER_URL ($HTTP_CODE)"
  elif [ "$HTTP_CODE" = "000" ]; then
    fail "Server unreachable: $SERVER_URL (connection failed)"
  else
    warn "Server responded: $SERVER_URL (HTTP $HTTP_CODE)"
  fi
else
  warn "No server URL found — can't test connectivity"
fi

# ══════════════════════════════════════════════════════
hdr "6. Recent Logs"
# ══════════════════════════════════════════════════════

echo ""
echo -e "${C}── Claude Code Hook Log ──${D}"
if [ -f "$CC_DEBUG_LOG" ]; then
  LOG_SIZE=$(wc -c < "$CC_DEBUG_LOG" | xargs)
  LOG_LINES=$(wc -l < "$CC_DEBUG_LOG" | xargs)
  info "Size: $LOG_SIZE bytes, $LOG_LINES lines"
  echo -e "${D}"
  tail -5 "$CC_DEBUG_LOG" 2>/dev/null | sed 's/^/  /'
else
  warn "No CC debug log"
fi

echo ""
echo -e "${C}── Codex Hook Log ──${D}"
if [ -f "$CODEX_DEBUG_LOG" ]; then
  LOG_SIZE=$(wc -c < "$CODEX_DEBUG_LOG" | xargs)
  LOG_LINES=$(wc -l < "$CODEX_DEBUG_LOG" | xargs)
  info "Size: $LOG_SIZE bytes, $LOG_LINES lines"
  echo -e "${D}"
  tail -5 "$CODEX_DEBUG_LOG" 2>/dev/null | sed 's/^/  /'
else
  warn "No Codex debug log"
fi

echo ""
echo -e "${C}── Watcher Log ──${D}"
if [ -f "$WATCHER_LOG" ]; then
  LOG_SIZE=$(wc -c < "$WATCHER_LOG" | xargs)
  LOG_LINES=$(wc -l < "$WATCHER_LOG" | xargs)
  info "Size: $LOG_SIZE bytes, $LOG_LINES lines"
  echo -e "${D}"
  tail -5 "$WATCHER_LOG" 2>/dev/null | sed 's/^/  /'
else
  warn "No watcher log"
fi

# ══════════════════════════════════════════════════════
hdr "7. Summary"
# ══════════════════════════════════════════════════════

echo ""
echo -e "  Node:    $(node --version 2>/dev/null || echo 'not found')"
echo -e "  Claude:  $(claude --version 2>/dev/null || echo 'not found')"
echo -e "  Codex:   $(codex --version 2>/dev/null || echo 'not found')"
echo -e "  OS:      $(uname -s) $(uname -m)"
echo ""
