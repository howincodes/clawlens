#!/usr/bin/env node

// ClawLens Hook Handler
// Reads Claude Code hook JSON from stdin, enriches it, POSTs to server.
// Returns server response to stdout (for blocking decisions).
// Fails open on any error — never breaks Claude Code.
//
// Debug: set CLAWLENS_DEBUG=1 to enable verbose logging to stderr + log file.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname, platform, release } from 'os';
import { execSync, spawn } from 'child_process';

// ── Debug logging ───────────────────────────────────
const VERSION = '1.1.0';
const HOME = homedir();
const HOOKS_DIR = join(HOME, '.claude', 'hooks');
const DEBUG = true; // Always log — writes to file only, never breaks Claude Code
const LOG_FILE = join(HOOKS_DIR, '.clawlens-debug.log');

function debug(msg) {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  try { process.stderr.write(line + '\n'); } catch {}
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ── Configuration ────────────────────────────────────
const CACHE_FILE = join(HOOKS_DIR, '.clawlens-cache.json');
const MODEL_CACHE = join(HOOKS_DIR, '.clawlens-model.txt');

const SERVER_URL = process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL
  || process.env.CLAWLENS_SERVER || '';
const AUTH_TOKEN = process.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN
  || process.env.CLAWLENS_TOKEN || '';

debug(`──── ClawLens hook v${VERSION} starting ────`);
debug(`HOME=${HOME}`);
debug(`HOOKS_DIR=${HOOKS_DIR}`);
debug(`SERVER_URL=${SERVER_URL ? SERVER_URL : '(empty)'}`);
debug(`AUTH_TOKEN=${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(empty)'}`);
debug(`ENV CLAUDE_PLUGIN_OPTION_SERVER_URL=${process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL || '(not set)'}`);
debug(`ENV CLAWLENS_SERVER=${process.env.CLAWLENS_SERVER || '(not set)'}`);
debug(`ENV CLAUDE_PLUGIN_OPTION_AUTH_TOKEN=${process.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN ? '(set)' : '(not set)'}`);
debug(`ENV CLAWLENS_TOKEN=${process.env.CLAWLENS_TOKEN ? '(set)' : '(not set)'}`);
debug(`Node ${process.version}, platform=${platform()}, cwd=${process.cwd()}`);

if (!SERVER_URL || !AUTH_TOKEN) {
  debug(`EXITING: missing SERVER_URL or AUTH_TOKEN — nothing to do`);
  process.exit(0);
}

// ── Helpers ──────────────────────────────────────────
function readJSON(filepath) {
  try {
    const raw = readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(raw);
    debug(`readJSON(${filepath}): OK (keys: ${Object.keys(parsed).join(', ')})`);
    return parsed;
  } catch (e) {
    debug(`readJSON(${filepath}): FAILED — ${e.message}`);
    return null;
  }
}

function readText(filepath) {
  try {
    const val = readFileSync(filepath, 'utf-8').trim();
    debug(`readText(${filepath}): "${val}"`);
    return val;
  } catch (e) {
    debug(`readText(${filepath}): FAILED — ${e.message}`);
    return null;
  }
}

function writeText(filepath, text) {
  try {
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, text);
    debug(`writeText(${filepath}): wrote "${text}"`);
  } catch (e) {
    debug(`writeText(${filepath}): FAILED — ${e.message}`);
  }
}

function writeJSON(filepath, data) {
  try {
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, JSON.stringify(data));
    debug(`writeJSON(${filepath}): OK`);
  } catch (e) {
    debug(`writeJSON(${filepath}): FAILED — ${e.message}`);
  }
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
  debug(`readStdin: reading fd 0...`);
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    debug(`readStdin: got ${raw.length} chars`);
    debug(`readStdin: first 500 chars: ${raw.slice(0, 500)}`);
    const parsed = JSON.parse(raw);
    debug(`readStdin: parsed OK — hook_event_name=${parsed.hook_event_name}, session_id=${parsed.session_id}`);
    return parsed;
  } catch (e) {
    debug(`readStdin: FAILED — ${e.message}`);
    return null;
  }
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
  let result;
  if (lower.includes('opus')) result = 'opus';
  else if (lower.includes('sonnet')) result = 'sonnet';
  else if (lower.includes('haiku')) result = 'haiku';
  else result = raw || 'sonnet';
  debug(`normalizeModel("${raw}") → "${result}"`);
  return result;
}

function getPlanDefaultModel() {
  // Get fresh subscription info (uses cache with TTL) so we never
  // read a stale cache file that hasn't been refreshed yet.
  debug(`getPlanDefaultModel: getting fresh subscription info...`);
  const sub = getSubscriptionInfo();
  const subType = (sub?.subscriptionType || '').toLowerCase();
  debug(`getPlanDefaultModel: subscriptionType="${subType}"`);
  if (subType.includes('max')) { debug(`getPlanDefaultModel → opus (max plan)`); return 'opus'; }
  if (subType.includes('team_premium')) { debug(`getPlanDefaultModel → opus (team_premium)`); return 'opus'; }
  debug(`getPlanDefaultModel → sonnet (default)`);
  return 'sonnet';
}

function detectModel(hookData) {
  debug(`detectModel: starting model detection chain...`);

  // 1. From hook JSON (SessionStart sends model, others don't)
  if (hookData?.model) {
    debug(`detectModel: [1] found model in hook JSON: "${hookData.model}"`);
    return normalizeModel(hookData.model);
  }
  debug(`detectModel: [1] no model in hook JSON`);

  // 2. User settings (~/.claude/settings.json)
  const settingsPath = join(HOME, '.claude', 'settings.json');
  debug(`detectModel: [2] checking ${settingsPath}`);
  const userSettings = readJSON(settingsPath);
  if (userSettings) {
    if (userSettings.model) {
      debug(`detectModel: [2] found model in user settings: "${userSettings.model}"`);
      return normalizeModel(userSettings.model);
    }
    debug(`detectModel: [2] settings exists but no model key → plan default`);
    return getPlanDefaultModel();
  }
  debug(`detectModel: [2] no user settings file`);

  // 3. Local project settings (.claude/settings.local.json)
  const localPath = join(process.cwd(), '.claude', 'settings.local.json');
  debug(`detectModel: [3] checking ${localPath}`);
  try {
    const localSettings = readJSON(localPath);
    if (localSettings?.model) {
      debug(`detectModel: [3] found model in local settings: "${localSettings.model}"`);
      return normalizeModel(localSettings.model);
    }
  } catch {}
  debug(`detectModel: [3] no local settings model`);

  // 4. Project settings (.claude/settings.json)
  const projPath = join(process.cwd(), '.claude', 'settings.json');
  debug(`detectModel: [4] checking ${projPath}`);
  try {
    const projSettings = readJSON(projPath);
    if (projSettings?.model) {
      debug(`detectModel: [4] found model in project settings: "${projSettings.model}"`);
      return normalizeModel(projSettings.model);
    }
  } catch {}
  debug(`detectModel: [4] no project settings model`);

  // 5. Cached from last SessionStart
  debug(`detectModel: [5] checking model cache ${MODEL_CACHE}`);
  const cached = readText(MODEL_CACHE);
  if (cached) {
    debug(`detectModel: [5] found cached model: "${cached}"`);
    return normalizeModel(cached);
  }
  debug(`detectModel: [5] no cached model`);

  // 6. Environment variables
  if (process.env.ANTHROPIC_MODEL) {
    debug(`detectModel: [6] ANTHROPIC_MODEL="${process.env.ANTHROPIC_MODEL}"`);
    return normalizeModel(process.env.ANTHROPIC_MODEL);
  }
  if (process.env.CLAUDE_MODEL) {
    debug(`detectModel: [6] CLAUDE_MODEL="${process.env.CLAUDE_MODEL}"`);
    return normalizeModel(process.env.CLAUDE_MODEL);
  }
  debug(`detectModel: [6] no env vars`);

  // 7. Plan default
  debug(`detectModel: [7] falling back to plan default`);
  return getPlanDefaultModel();
}

// ══════════════════════════════════════════════════════
// SUBSCRIPTION TYPE NORMALIZATION
//
// Raw values from various sources (claude auth status, ~/.claude.json)
// can be human-unfriendly strings like "STRIPE_SUBSCRIPTION".
// Normalize them to clean plan names for display and storage.
// ══════════════════════════════════════════════════════

function normalizeSubscriptionType(raw) {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('max')) return 'max';
  return 'pro';
}

// ══════════════════════════════════════════════════════
// SUBSCRIPTION INFO (cached — expensive to fetch)
// ══════════════════════════════════════════════════════

function getSubscriptionInfo() {
  debug(`getSubscriptionInfo: starting...`);

  // Check cache (5 minute TTL, version 2 required — old caches are invalidated)
  const cached = readJSON(CACHE_FILE);
  if (cached?.email && cached._v === 2 && Date.now() - (cached._ts || 0) < 300000) {
    const age = Math.round((Date.now() - cached._ts) / 1000);
    // Cache stores RAW value, normalize on read
    const result = { ...cached, subscriptionType: normalizeSubscriptionType(cached._rawSubType || cached.subscriptionType) };
    debug(`getSubscriptionInfo: using cache (age=${age}s) — email=${result.email}, raw=${cached._rawSubType}, normalized=${result.subscriptionType}`);
    return result;
  }
  debug(`getSubscriptionInfo: cache miss, expired, or old version`);

  // Method 1: claude auth status (most accurate, ~1-2s)
  debug(`getSubscriptionInfo: [method 1] running "claude auth status"...`);
  try {
    const start = Date.now();
    const output = execSync('claude auth status', {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const elapsed = Date.now() - start;
    debug(`getSubscriptionInfo: [method 1] completed in ${elapsed}ms`);
    debug(`getSubscriptionInfo: [method 1] raw output: ${output.slice(0, 500)}`);
    const auth = JSON.parse(output);
    debug(`getSubscriptionInfo: [method 1] parsed keys: ${Object.keys(auth).join(', ')}`);
    const rawSubType = auth.subscriptionType || auth.planType || '';
    const info = {
      email: auth.email || auth.emailAddress || '',
      subscriptionType: normalizeSubscriptionType(rawSubType),
      orgName: auth.orgName || auth.organizationName || '',
    };
    debug(`getSubscriptionInfo: [method 1] result: email=${info.email}, raw=${rawSubType}, normalized=${info.subscriptionType}`);
    // Cache RAW value so normalization changes take effect on next read
    writeJSON(CACHE_FILE, { ...info, _rawSubType: rawSubType, _ts: Date.now(), _v: 2 });
    return info;
  } catch (e) {
    debug(`getSubscriptionInfo: [method 1] FAILED — ${e.message}`);
  }

  // claude auth status is the ONLY source of truth for subscription type.
  // Do NOT fall back to ~/.claude.json — it has unreliable fields like "stripe_subscription".
  debug(`getSubscriptionInfo: claude auth status failed — returning unknown`);
  return { email: '', subscriptionType: 'unknown', orgName: '' };
}

// ══════════════════════════════════════════════════════
// NOTIFICATIONS — Cross-Platform Desktop Notifications
// ══════════════════════════════════════════════════════

const CONFIG_FILE = join(HOOKS_DIR, '.clawlens-config.json');

function shouldNotify(eventType) {
  try {
    const config = readJSON(CONFIG_FILE);
    const prefs = config?.notifications;
    // Default: notifications ON if no config synced yet
    if (!prefs) return true;
    switch (eventType) {
      case 'stop': return prefs.on_stop !== false;
      case 'block': return prefs.on_block !== false;
      case 'credit_warning': return prefs.on_credit_warning !== false;
      case 'kill': return prefs.on_kill !== false;
      default: return true;
    }
  } catch { return true; }
}

function notifyUser(title, message) {
  try {
    const p = platform();
    if (p === 'darwin') {
      // macOS: async, fire-and-forget
      spawn('osascript', ['-e', `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" sound name "Ping"`], { stdio: 'ignore' }).unref();
    } else if (p === 'win32') {
      // Windows: write temp .ps1, run via powershell (NOT detached — needs desktop session)
      const tmpPs1 = join(HOOKS_DIR, '.clawlens-notify.ps1');
      writeFileSync(tmpPs1, `Add-Type -AssemblyName System.Windows.Forms
$n = New-Object System.Windows.Forms.NotifyIcon
$n.Icon = [System.Drawing.SystemIcons]::Information
$n.Visible = $true
$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'
$n.BalloonTipText = '${message.replace(/'/g, "''")}'
$n.ShowBalloonTip(5000)
[System.Media.SystemSounds]::Asterisk.Play()
Start-Sleep 6
$n.Dispose()`);
      // Use Start-Process launcher — only way to keep GUI session context on Windows
      const launcherPs1 = join(HOOKS_DIR, '.clawlens-notify-launcher.ps1');
      writeFileSync(launcherPs1, `Start-Process powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${tmpPs1.replace(/'/g, "''")}') -WindowStyle Hidden`);
      execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${launcherPs1}"`, { timeout: 10000, stdio: 'ignore' });
    } else {
      // Linux: async, fire-and-forget
      spawn('notify-send', [title, message, '--urgency=normal'], { stdio: 'ignore' }).unref();
      try { spawn('paplay', ['/usr/share/sounds/freedesktop/stereo/message.oga'], { stdio: 'ignore' }).unref(); } catch {}
    }
    debug(`notifyUser: sent "${title}" — "${message}"`);
  } catch (e) {
    debug(`notifyUser: failed — ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════
// SESSION START ENRICHMENT
// ══════════════════════════════════════════════════════

function enrichSessionStart(data) {
  debug(`enrichSessionStart: enriching session data...`);
  const sub = getSubscriptionInfo();
  const model = detectModel(data);

  // Cache model for subsequent hooks (they don't get model in stdin)
  writeText(MODEL_CACHE, model);

  const enriched = {
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
  debug(`enrichSessionStart: model=${model}, email=${sub.email}, type=${sub.subscriptionType}, hostname=${enriched.hostname}`);
  return enriched;
}

// ══════════════════════════════════════════════════════
// WATCHER BACKUP SPAWN
// ══════════════════════════════════════════════════════

function checkAndSpawnWatcher() {
  const pidFile = join(HOOKS_DIR, '.clawlens-watcher.pid');
  const watcherFile = join(HOOKS_DIR, 'clawlens-watcher.mjs');
  try {
    // Check if watcher file exists
    try { readFileSync(watcherFile); } catch { debug('watcher file not found'); return; }

    // Check if already running
    const pidStr = readText(pidFile);
    if (pidStr) {
      try { process.kill(parseInt(pidStr, 10), 0); debug(`watcher alive (pid=${pidStr})`); return; }
      catch { debug(`watcher dead (stale pid=${pidStr})`); }
    }

    // Spawn watcher detached
    debug(`spawning watcher: node ${watcherFile}`);
    const child = spawn('node', [watcherFile], { detached: true, stdio: 'ignore', env: { ...process.env } });
    child.unref();
    debug(`watcher spawned (pid=${child.pid})`);
  } catch (e) {
    debug(`watcher spawn failed: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════
// POST TO SERVER
// ══════════════════════════════════════════════════════

async function postToServer(apiPath, body) {
  const url = `${SERVER_URL.replace(/\/$/, '')}/api/v1/hook/${apiPath}`;
  debug(`postToServer: POST ${url}`);
  debug(`postToServer: payload keys: ${Object.keys(body).join(', ')}`);
  debug(`postToServer: payload size: ${JSON.stringify(body).length} bytes`);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    debug(`postToServer: TIMEOUT after 3000ms — aborting`);
    controller.abort();
  }, 3000);

  try {
    const start = Date.now();
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
    const elapsed = Date.now() - start;
    debug(`postToServer: response status=${resp.status} (${resp.statusText}) in ${elapsed}ms`);

    const text = await resp.text();
    debug(`postToServer: response body (${text.length} chars): ${text.slice(0, 500)}`);

    if (resp.status !== 200) {
      debug(`postToServer: WARNING — non-200 status: ${resp.status}`);
    }

    return text || '';
  } catch (e) {
    clearTimeout(timer);
    debug(`postToServer: FAILED — ${e.name}: ${e.message}`);
    return '';
  }
}

// ══════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════

async function main() {
  const data = readStdin();
  if (!data?.hook_event_name) {
    debug(`EXITING: no hook_event_name in stdin data`);
    process.exit(0);
  }

  const event = data.hook_event_name;
  const apiPath = EVENT_PATHS[event];
  debug(`main: event="${event}" → apiPath="${apiPath || '(unknown)'}"`);
  debug(`main: session_id=${data.session_id || '(none)'}`);

  if (!apiPath) {
    debug(`EXITING: unknown event "${event}" — not in EVENT_PATHS`);
    process.exit(0);
  }

  // Enrich SessionStart with subscription + model + device info
  let payload;
  if (event === 'SessionStart') {
    debug(`main: enriching SessionStart...`);
    payload = enrichSessionStart(data);
    checkAndSpawnWatcher();
  } else {
    // For all non-SessionStart events, detect and include the current model
    // so the server can track model changes mid-session (e.g. /model command)
    const currentModel = detectModel(data);
    debug(`main: detected model for ${event}: "${currentModel}"`);
    payload = { ...data, model: currentModel };
  }

  const response = await postToServer(apiPath, payload);
  if (response) {
    debug(`main: writing response to stdout: ${response.slice(0, 200)}`);
    process.stdout.write(response);

    // Notify on block decisions from the server
    try {
      const resp = JSON.parse(response);
      if (resp.decision === 'block' && shouldNotify('block')) {
        notifyUser('ClawLens', resp.reason || 'Prompt blocked');
      }
    } catch {}
  } else {
    debug(`main: no response from server (empty) — allowing`);
  }

  // Notify on Stop (task completed) — only for real completions, not stop_hook_active
  if (event === 'Stop' && data.stop_hook_active !== true && shouldNotify('stop')) {
    notifyUser('ClawLens', 'Task completed');
  }

  debug(`──── ClawLens hook done ────`);
}

main().catch((e) => {
  debug(`FATAL: main() threw: ${e.stack || e.message}`);
  process.exit(0);
});
