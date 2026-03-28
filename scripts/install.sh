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

echo "[1/3] Installing hook handler..."

HOOK_DIR="$HOME/.claude/hooks"
MJS_FILE="$HOOK_DIR/clawlens.mjs"
HOOK_SCRIPT="$HOOK_DIR/clawlens-hook.sh"
mkdir -p "$HOOK_DIR"

# Write the Node.js hook handler (zero dependencies, Node 18+)
cat > "$MJS_FILE" << 'MJSEOF'
#!/usr/bin/env node

// ClawLens Hook Handler
// Reads Claude Code hook JSON from stdin, enriches it, POSTs to server.
// Returns server response to stdout (for blocking decisions).
// Fails open on any error — never breaks Claude Code.

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname, platform, release } from 'os';
import { execSync } from 'child_process';

// ── Configuration ────────────────────────────────────
const HOME = homedir();
const HOOKS_DIR = join(HOME, '.claude', 'hooks');
const CACHE_FILE = join(HOOKS_DIR, '.clawlens-cache.json');
const MODEL_CACHE = join(HOOKS_DIR, '.clawlens-model.txt');

const SERVER_URL = process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL
  || process.env.CLAWLENS_SERVER || '';
const AUTH_TOKEN = process.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN
  || process.env.CLAWLENS_TOKEN || '';

if (!SERVER_URL || !AUTH_TOKEN) process.exit(0);

// ── Helpers ──────────────────────────────────────────
function readJSON(filepath) {
  try { return JSON.parse(readFileSync(filepath, 'utf-8')); }
  catch { return null; }
}

function readText(filepath) {
  try { return readFileSync(filepath, 'utf-8').trim(); }
  catch { return null; }
}

function writeText(filepath, text) {
  try {
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, text);
  } catch {}
}

function writeJSON(filepath, data) {
  try {
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, JSON.stringify(data));
  } catch {}
}

// ── Event → API path ────────────────────────────────
const EVENT_PATHS = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'pre-tool',
  Stop: 'stop',
  StopFailure: 'stop-error',
  SessionEnd: 'session-end',
  PostToolUse: 'post-tool',
  SubagentStart: 'subagent-start',
  PostToolUseFailure: 'post-tool-failure',
  ConfigChange: 'config-change',
  FileChanged: 'file-changed',
};

// ── Read stdin ───────────────────────────────────────
function readStdin() {
  try { return JSON.parse(readFileSync(0, 'utf-8').trim()); }
  catch { return null; }
}

// ══════════════════════════════════════════════════════
// MODEL DETECTION
//
// Priority (matches claude-code-limiter):
//   1. Hook stdin JSON → model field (SessionStart only)
//   2. ~/.claude/settings.json → model (set by /model command)
//      - If settings exists but NO model key → user chose plan default
//   3. .claude/settings.local.json → model (project-local override)
//   4. .claude/settings.json (project) → model
//   5. Cached session-model.txt (from last SessionStart)
//   6. ANTHROPIC_MODEL env var
//   7. CLAUDE_MODEL env var
//   8. Plan default (Max=opus, Pro/Team=sonnet)
//   9. "sonnet" ultimate fallback
//
// Key insight: /model writes "model" key for non-default.
// Selecting default REMOVES the key. So key absent = plan default.
// ══════════════════════════════════════════════════════

function normalizeModel(raw) {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return raw || 'sonnet';
}

function getPlanDefaultModel() {
  // Determine from subscription type: Max → opus, everything else → sonnet
  const cache = readJSON(CACHE_FILE);
  const subType = (cache?.subscriptionType || '').toLowerCase();
  if (subType.includes('max')) return 'opus';
  if (subType.includes('team_premium')) return 'opus';
  return 'sonnet';
}

function detectModel(hookData) {
  // 1. From hook JSON (SessionStart sends model, others don't)
  if (hookData?.model) {
    return normalizeModel(hookData.model);
  }

  // 2. User settings (~/.claude/settings.json)
  const userSettings = readJSON(join(HOME, '.claude', 'settings.json'));
  if (userSettings) {
    if (userSettings.model) {
      return normalizeModel(userSettings.model);
    }
    // Settings exists but no model key = user chose the default
    // Use plan default immediately, don't fall through to stale caches
    return getPlanDefaultModel();
  }

  // 3. Local project settings (.claude/settings.local.json)
  try {
    const localSettings = readJSON(join(process.cwd(), '.claude', 'settings.local.json'));
    if (localSettings?.model) return normalizeModel(localSettings.model);
  } catch {}

  // 4. Project settings (.claude/settings.json)
  try {
    const projSettings = readJSON(join(process.cwd(), '.claude', 'settings.json'));
    if (projSettings?.model) return normalizeModel(projSettings.model);
  } catch {}

  // 5. Cached from last SessionStart
  const cached = readText(MODEL_CACHE);
  if (cached) return normalizeModel(cached);

  // 6. Environment variables
  if (process.env.ANTHROPIC_MODEL) return normalizeModel(process.env.ANTHROPIC_MODEL);
  if (process.env.CLAUDE_MODEL) return normalizeModel(process.env.CLAUDE_MODEL);

  // 7. Plan default
  return getPlanDefaultModel();
}

// ══════════════════════════════════════════════════════
// SUBSCRIPTION INFO (cached — expensive to fetch)
// ══════════════════════════════════════════════════════

function getSubscriptionInfo() {
  // Check cache (5 minute TTL)
  const cached = readJSON(CACHE_FILE);
  if (cached?.email && Date.now() - (cached._ts || 0) < 300000) {
    return cached;
  }

  // Method 1: claude auth status (most accurate, ~1-2s)
  try {
    const output = execSync('claude auth status', {
      timeout: 2000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const auth = JSON.parse(output);
    const info = {
      email: auth.email || auth.emailAddress || '',
      subscriptionType: auth.subscriptionType || auth.planType || '',
      orgName: auth.orgName || auth.organizationName || '',
    };
    writeJSON(CACHE_FILE, { ...info, _ts: Date.now() });
    return info;
  } catch {}

  // Method 2: read ~/.claude.json directly (no subprocess, instant)
  try {
    const cj = readJSON(join(HOME, '.claude.json'));
    if (cj?.oauthAccount) {
      const acct = cj.oauthAccount;
      const info = {
        email: acct.emailAddress || acct.email || '',
        subscriptionType: acct.planType || acct.billingType || '',
        orgName: acct.organizationName || acct.displayName || '',
      };
      writeJSON(CACHE_FILE, { ...info, _ts: Date.now() });
      return info;
    }
  } catch {}

  return { email: '', subscriptionType: '', orgName: '' };
}

// ══════════════════════════════════════════════════════
// SESSION START ENRICHMENT
// ══════════════════════════════════════════════════════

function enrichSessionStart(data) {
  const sub = getSubscriptionInfo();
  const model = detectModel(data);

  // Cache model for subsequent hooks (they don't get model in stdin)
  writeText(MODEL_CACHE, model);

  return {
    ...data,
    model,
    detected_model: model,
    subscription_email: sub.email,
    subscription_type: sub.subscriptionType,
    org_name: sub.orgName,
    hostname: hostname(),
    platform: platform(),
    os_version: release(),
    node_version: process.version,
  };
}

// ══════════════════════════════════════════════════════
// POST TO SERVER
// ══════════════════════════════════════════════════════

async function postToServer(apiPath, body) {
  const url = `${SERVER_URL.replace(/\/$/, '')}/api/v1/hook/${apiPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    return text || '';
  } catch {
    clearTimeout(timer);
    return '';
  }
}

// ══════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════

async function main() {
  const data = readStdin();
  if (!data?.hook_event_name) process.exit(0);

  const event = data.hook_event_name;
  const apiPath = EVENT_PATHS[event];
  if (!apiPath) process.exit(0);

  // Enrich SessionStart with subscription + model + device info
  const payload = event === 'SessionStart' ? enrichSessionStart(data) : data;

  const response = await postToServer(apiPath, payload);
  if (response) process.stdout.write(response);
}

main().catch(() => process.exit(0));
MJSEOF

chmod 644 "$MJS_FILE"
echo "  -> $MJS_FILE"

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
echo "  Hook handler: $MJS_FILE"
echo "  Hook wrapper: $HOOK_SCRIPT"
echo "  Settings:     $SETTINGS_FILE"
echo "  Server:       $SERVER_URL"
echo ""
echo "  Close ALL terminals, then open a fresh one and run: claude"
echo ""
