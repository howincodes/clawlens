#!/usr/bin/env node

// ClawLens Watcher — Persistent background process for developer machines.
// Hook auto-repair, poll-based server sync, credit notifications, status command.
// Zero npm dependencies — Node 18+ built-ins only.
//
// Usage:
//   node clawlens-watcher.mjs          — start watcher daemon
//   node clawlens-watcher.mjs status   — print status and exit
//
// Debug: set CLAWLENS_DEBUG=1 to enable verbose logging to stderr + log file.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, statSync, unlinkSync, renameSync, openSync, readSync, closeSync, watchFile } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname, platform } from 'os';
import { execSync } from 'child_process';

// ── Constants ───────────────────────────────────────
const VERSION = '1.0.0';
const HOME = homedir();
const HOOKS_DIR = join(HOME, '.claude', 'hooks');
const SETTINGS_FILE = join(HOME, '.claude', 'settings.json');
const PID_FILE = join(HOOKS_DIR, '.clawlens-watcher.pid');
const LOG_FILE = join(HOOKS_DIR, '.clawlens-watcher.log');
const CONFIG_FILE = join(HOOKS_DIR, '.clawlens-config.json');
const CACHE_FILE = join(HOOKS_DIR, '.clawlens-cache.json');
const MODEL_CACHE = join(HOOKS_DIR, '.clawlens-model.txt');
const DEBUG_LOG_FILE = join(HOOKS_DIR, '.clawlens-debug.log');
const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';

const LOG_MAX_SIZE = 1024 * 1024;       // 1MB
const LOG_KEEP_SIZE = 512 * 1024;       // 500KB
const REPAIR_DEBOUNCE_MS = 1000;
const DEFAULT_POLL_MS = 300000;          // 5 minutes
const MIN_POLL_MS = 30000;              // 30 seconds
const MAX_POLL_MS = 3600000;            // 1 hour
const REQUEST_TIMEOUT_MS = 5000;
const UPLOAD_MAX_BYTES = 512 * 1024;    // 500KB

const HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure',
  'SessionEnd', 'PostToolUse', 'SubagentStart', 'PostToolUseFailure',
  'ConfigChange', 'FileChanged',
];

const HOOK_TEMPLATE = {
  SessionStart: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 5 }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 3 }] }],
  PreToolUse: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 2, async: true }] }],
  Stop: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 3 }] }],
  StopFailure: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 2, async: true }] }],
  SessionEnd: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 3, async: true }] }],
  PostToolUse: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 3, async: true }] }],
  SubagentStart: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 2, async: true }] }],
  PostToolUseFailure: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 2, async: true }] }],
  ConfigChange: [{ hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 3 }] }],
  FileChanged: [{ matcher: 'settings.json', hooks: [{ type: 'command', command: '~/.claude/hooks/clawlens-hook.sh', timeout: 3 }] }],
};

// ── State ───────────────────────────────────────────
const startTime = Date.now();
let pollIntervalMs = DEFAULT_POLL_MS;
let lastRepairTime = 0;
let lastModel = null;
let lastServerUrl = null;
let lastAuthToken = null;
let notifiedCredits = { day: null, at80: false, at100: false };
let SERVER_URL = '';
let AUTH_TOKEN = '';

// ══════════════════════════════════════════════════════
// 1. CONFIGURATION + PID MANAGEMENT
// ══════════════════════════════════════════════════════

function loadEnvFromSettings() {
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    if (settings.env?.CLAUDE_PLUGIN_OPTION_SERVER_URL)
      process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL = settings.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
    if (settings.env?.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN)
      process.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN = settings.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN;
  } catch {}
}

function loadConfig() {
  loadEnvFromSettings();
  SERVER_URL = process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL
    || process.env.CLAWLENS_SERVER || '';
  AUTH_TOKEN = process.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN
    || process.env.CLAWLENS_TOKEN || '';
}

function isProcessAlive(pid) {
  try { process.kill(parseInt(pid, 10), 0); return true; }
  catch { return false; }
}

function checkDuplicate() {
  try {
    const pidStr = readFileSync(PID_FILE, 'utf-8').trim();
    if (pidStr && isProcessAlive(pidStr)) {
      log(`Another watcher is already running (PID ${pidStr}). Exiting.`);
      process.exit(0);
    }
  } catch {}
}

function writePidFile() {
  try {
    mkdirSync(dirname(PID_FILE), { recursive: true });
    writeFileSync(PID_FILE, String(process.pid));
  } catch (e) {
    log(`Failed to write PID file: ${e.message}`);
  }
}

function cleanupPidFile() {
  try { unlinkSync(PID_FILE); } catch {}
}

function setupSignalHandlers() {
  const cleanup = (signal) => {
    log(`Received ${signal} — shutting down`);
    cleanupPidFile();
    process.exit(0);
  };
  process.on('SIGTERM', () => cleanup('SIGTERM'));
  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('uncaughtException', (e) => {
    log(`Uncaught exception: ${e.stack || e.message}`);
    cleanupPidFile();
    process.exit(1);
  });
}

// ══════════════════════════════════════════════════════
// 2. LOG MANAGER
// ══════════════════════════════════════════════════════

function rotateLogIfNeeded() {
  try {
    const stat = statSync(LOG_FILE);
    if (stat.size <= LOG_MAX_SIZE) return;
    const content = readFileSync(LOG_FILE, 'utf-8');
    const truncated = content.slice(content.length - LOG_KEEP_SIZE);
    // Find next newline to avoid partial line
    const nlIdx = truncated.indexOf('\n');
    writeFileSync(LOG_FILE, nlIdx >= 0 ? truncated.slice(nlIdx + 1) : truncated);
  } catch {}
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  if (DEBUG) {
    try { process.stderr.write(line); } catch {}
  }
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line);
    rotateLogIfNeeded();
  } catch {}
}

function readLogFile(path, maxBytes) {
  try {
    const stat = statSync(path);
    const size = stat.size;
    if (size === 0) return '';
    const readSize = Math.min(size, maxBytes);
    const fd = openSync(path, 'r');
    const buf = Buffer.alloc(readSize);
    readSync(fd, buf, 0, readSize, size - readSize);
    closeSync(fd);
    return buf.toString('utf-8');
  } catch {
    return '';
  }
}

// ══════════════════════════════════════════════════════
// 3. NOTIFIER — Cross-Platform Desktop Notifications
// ══════════════════════════════════════════════════════

function escapeShellArg(str) {
  // Escape single quotes for shell: replace ' with '"'"'
  return str.replace(/'/g, "'\"'\"'");
}

function escapeDoubleQuotes(str) {
  return str.replace(/"/g, '\\"');
}

function escapePowerShell(str) {
  return str.replace(/'/g, "''").replace(/`/g, '``');
}

function notify(title, message) {
  const plat = platform();
  try {
    if (plat === 'darwin') {
      execSync(`osascript -e 'display notification "${escapeDoubleQuotes(message)}" with title "${escapeDoubleQuotes(title)}" sound name "Ping"'`, {
        timeout: 5000,
        stdio: 'ignore',
      });
    } else if (plat === 'linux') {
      execSync(`notify-send '${escapeShellArg(title)}' '${escapeShellArg(message)}' --urgency=normal`, {
        timeout: 5000,
        stdio: 'ignore',
      });
      // Play sound in background, ignore errors
      try {
        execSync('paplay /usr/share/sounds/freedesktop/stereo/message.oga &', {
          timeout: 5000,
          stdio: 'ignore',
          shell: true,
        });
      } catch {}
    } else if (plat === 'win32') {
      // Windows: write a temp .ps1 file to avoid cmd→powershell quoting hell
      const tmpPs1 = join(HOOKS_DIR, '.clawlens-notify.ps1');
      const ps1Content = `Add-Type -AssemblyName System.Windows.Forms
\$n = New-Object System.Windows.Forms.NotifyIcon
\$n.Icon = [System.Drawing.SystemIcons]::Information
\$n.Visible = \$true
\$n.BalloonTipTitle = '${title.replace(/'/g, "''")}'
\$n.BalloonTipText = '${message.replace(/'/g, "''")}'
\$n.ShowBalloonTip(5000)
[System.Media.SystemSounds]::Asterisk.Play()
Start-Sleep 6
\$n.Dispose()`;
      writeFileSync(tmpPs1, ps1Content);
      execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpPs1}"`, {
        timeout: 15000, stdio: 'ignore', windowsHide: true,
      });
      try { unlinkSync(tmpPs1); } catch {}
    }
    log(`Notification sent: "${title}" — "${message}"`);
  } catch (e) {
    log(`Notification failed (${plat}): ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════
// HELPERS (matching clawlens.mjs patterns)
// ══════════════════════════════════════════════════════

function readJSON(filepath) {
  try {
    return JSON.parse(readFileSync(filepath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeJSON(filepath, data) {
  try {
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, JSON.stringify(data));
  } catch {}
}

function readText(filepath) {
  try {
    return readFileSync(filepath, 'utf-8').trim();
  } catch {
    return null;
  }
}

async function postJSON(path, body, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!SERVER_URL || !AUTH_TOKEN) return null;
  const url = `${SERVER_URL.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
    return await resp.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ══════════════════════════════════════════════════════
// MODEL + SUBSCRIPTION (reuse patterns from clawlens.mjs)
// ══════════════════════════════════════════════════════

function normalizeModel(raw) {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return raw || 'sonnet';
}

function normalizeSubscriptionType(raw) {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('max')) return 'max';
  return 'pro';
}

function getPlanDefaultModel() {
  // Get fresh subscription info (uses cache with TTL) so we never
  // read a stale cache file that hasn't been refreshed yet.
  const sub = getSubscriptionInfo();
  const subType = (sub?.subscriptionType || '').toLowerCase();
  if (subType.includes('max')) return 'opus';
  if (subType.includes('team_premium')) return 'opus';
  return 'sonnet';
}

function detectModel() {
  // 1. User settings (~/.claude/settings.json)
  const userSettings = readJSON(SETTINGS_FILE);
  if (userSettings) {
    if (userSettings.model) return normalizeModel(userSettings.model);
    return getPlanDefaultModel();
  }
  // 2. Cached from last SessionStart
  const cached = readText(MODEL_CACHE);
  if (cached) return normalizeModel(cached);
  // 3. Environment variables
  if (process.env.ANTHROPIC_MODEL) return normalizeModel(process.env.ANTHROPIC_MODEL);
  if (process.env.CLAUDE_MODEL) return normalizeModel(process.env.CLAUDE_MODEL);
  // 4. Plan default
  return getPlanDefaultModel();
}

function getSubscriptionInfo() {
  // Check cache (5 minute TTL, version 2 — old caches invalidated)
  const cached = readJSON(CACHE_FILE);
  if (cached?.email && cached._v === 2 && Date.now() - (cached._ts || 0) < 300000) {
    return { ...cached, subscriptionType: normalizeSubscriptionType(cached._rawSubType || cached.subscriptionType) };
  }

  // Method 1: claude auth status
  try {
    const output = execSync('claude auth status', {
      timeout: 2000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const auth = JSON.parse(output);
    const rawSubType = auth.subscriptionType || auth.planType || '';
    const info = {
      email: auth.email || auth.emailAddress || '',
      subscriptionType: normalizeSubscriptionType(rawSubType),
      orgName: auth.orgName || auth.organizationName || '',
    };
    writeJSON(CACHE_FILE, { ...info, _rawSubType: rawSubType, _ts: Date.now(), _v: 2 });
    return info;
  } catch {}

  // Method 2: read ~/.claude.json directly
  try {
    const cj = readJSON(join(HOME, '.claude.json'));
    if (cj?.oauthAccount) {
      const acct = cj.oauthAccount;
      const rawSubType = acct.planType || acct.billingType || '';
      const info = {
        email: acct.emailAddress || acct.email || '',
        subscriptionType: normalizeSubscriptionType(rawSubType),
        orgName: acct.organizationName || acct.displayName || '',
      };
      writeJSON(CACHE_FILE, { ...info, _rawSubType: rawSubType, _ts: Date.now(), _v: 2 });
      return info;
    }
  } catch {}

  return { email: '', subscriptionType: '', orgName: '' };
}

// ══════════════════════════════════════════════════════
// 4. FILE WATCHER — Hook Auto-Repair
// ══════════════════════════════════════════════════════

function hookGroupHasClawlens(hookGroup) {
  // A hook group is an object like { hooks: [...], matcher?: "..." }
  // Check if any hook in this group has a command containing 'clawlens'
  if (!hookGroup?.hooks || !Array.isArray(hookGroup.hooks)) return false;
  return hookGroup.hooks.some(h => typeof h.command === 'string' && h.command.includes('clawlens'));
}

function eventHasClawlensHook(eventGroups) {
  // eventGroups is an array of hook groups for a given event key
  if (!Array.isArray(eventGroups)) return false;
  return eventGroups.some(hookGroupHasClawlens);
}

function checkAndRepairHooks() {
  if (Date.now() - lastRepairTime < REPAIR_DEBOUNCE_MS) {
    log('Skipping repair — within debounce window');
    return;
  }

  let settings;
  try {
    settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch (e) {
    log(`Cannot read settings.json for hook repair: ${e.message}`);
    return;
  }

  // Detect model changes
  const currentModel = settings.model ? normalizeModel(settings.model) : null;
  if (lastModel !== null && currentModel !== lastModel) {
    log(`Model changed: ${lastModel} -> ${currentModel || '(plan default)'}`);
    // Report to server asynchronously — don't block
    postJSON('/api/v1/watcher/sync', {
      event: 'model_change',
      old_model: lastModel,
      new_model: currentModel || detectModel(),
      hostname: hostname(),
    }).catch(() => {});
  }
  if (currentModel !== null) lastModel = currentModel;
  else if (lastModel === null) lastModel = detectModel();

  // Detect env var removal
  if (settings.env) {
    const currentServerUrl = settings.env.CLAUDE_PLUGIN_OPTION_SERVER_URL || null;
    const currentAuthToken = settings.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN || null;

    if (lastServerUrl !== null && currentServerUrl === null) {
      log('WARNING: CLAUDE_PLUGIN_OPTION_SERVER_URL removed from settings.json env block');
    }
    if (lastAuthToken !== null && currentAuthToken === null) {
      log('WARNING: CLAUDE_PLUGIN_OPTION_AUTH_TOKEN removed from settings.json env block');
    }
    lastServerUrl = currentServerUrl;
    lastAuthToken = currentAuthToken;
  }

  // Check hooks
  if (!settings.hooks) settings.hooks = {};

  const missingEvents = [];
  for (const event of HOOK_EVENTS) {
    if (!eventHasClawlensHook(settings.hooks[event])) {
      missingEvents.push(event);
    }
  }

  if (missingEvents.length === 0) {
    log('All 11 ClawLens hooks intact');
    return;
  }

  log(`Missing ClawLens hooks for: ${missingEvents.join(', ')}`);

  // Repair: add missing hooks without touching existing ones
  for (const event of missingEvents) {
    if (!Array.isArray(settings.hooks[event])) {
      settings.hooks[event] = [];
    }
    // Append the template hook group(s) for this event
    for (const templateGroup of HOOK_TEMPLATE[event]) {
      settings.hooks[event].push(templateGroup);
    }
  }

  // Atomic write
  const tmpFile = SETTINGS_FILE + '.tmp';
  try {
    writeFileSync(tmpFile, JSON.stringify(settings, null, 2));
    renameSync(tmpFile, SETTINGS_FILE);
    lastRepairTime = Date.now();
    log(`Repaired hooks for: ${missingEvents.join(', ')}`);
    notify('ClawLens', `Repaired ${missingEvents.length} hook(s): ${missingEvents.join(', ')}`);

    // Report repair to server
    postJSON('/api/v1/watcher/sync', {
      event: 'hooks_repaired',
      repaired: missingEvents,
      hostname: hostname(),
    }).catch(() => {});
  } catch (e) {
    log(`Failed to write repaired settings.json: ${e.message}`);
    try { unlinkSync(tmpFile); } catch {}
  }
}

function startWatcher() {
  log(`Starting file watcher on ${SETTINGS_FILE}`);

  // Initialize env var tracking
  try {
    const settings = readJSON(SETTINGS_FILE);
    if (settings?.env) {
      lastServerUrl = settings.env.CLAUDE_PLUGIN_OPTION_SERVER_URL || null;
      lastAuthToken = settings.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN || null;
    }
    if (settings?.model) lastModel = normalizeModel(settings.model);
    else lastModel = detectModel();
  } catch {}

  watchFile(SETTINGS_FILE, { interval: 2000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    log('settings.json changed — checking hooks');
    loadConfig();
    checkAndRepairHooks();
  });
}

// ══════════════════════════════════════════════════════
// 5. SERVER COMMUNICATION — Poll-based
// ══════════════════════════════════════════════════════

function getHooksIntactCount() {
  try {
    const settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
    if (!settings.hooks) return 0;
    let count = 0;
    for (const event of HOOK_EVENTS) {
      if (eventHasClawlensHook(settings.hooks[event])) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

async function syncWithServer() {
  if (!SERVER_URL || !AUTH_TOKEN) {
    log('No SERVER_URL or AUTH_TOKEN — skipping sync');
    return;
  }

  const sub = getSubscriptionInfo();
  const model = detectModel();
  const intactCount = getHooksIntactCount();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const body = {
    heartbeat: true,
    model,
    subscription_email: sub.email,
    subscription_type: sub.subscriptionType,
    hostname: hostname(),
    platform: platform(),
    hooks_intact: intactCount === HOOK_EVENTS.length,
    hooks_intact_count: intactCount,
    hooks_total: HOOK_EVENTS.length,
    uptime_seconds: uptimeSeconds,
    watcher_version: VERSION,
  };

  log(`Syncing with server: model=${model}, email=${sub.email}, hooks=${intactCount}/${HOOK_EVENTS.length}`);

  const resp = await postJSON('/api/v1/watcher/sync', body);
  if (!resp) {
    log('Sync failed — no response from server');
    return;
  }

  log(`Sync response: status=${resp.status}, poll_interval_ms=${resp.poll_interval_ms}`);

  // Update poll interval from server
  if (resp.poll_interval_ms) {
    const clamped = Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, resp.poll_interval_ms));
    if (clamped !== pollIntervalMs) {
      log(`Poll interval updated: ${pollIntervalMs}ms -> ${clamped}ms`);
      pollIntervalMs = clamped;
    }
  }

  // Save config for offline status display + notification preferences
  const configData = {
    user: sub.email || 'unknown',
    model,
    status: resp.status || 'unknown',
    server: SERVER_URL,
    credit_usage: resp.credit_usage || null,
    limits: resp.limits || null,
    notifications: resp.notifications || null,
    last_sync: Date.now(),
    hooks_intact: intactCount,
    hooks_total: HOOK_EVENTS.length,
    watcher_version: VERSION,
    uptime_seconds: uptimeSeconds,
  };
  writeJSON(CONFIG_FILE, configData);

  // Process commands
  let hadCommands = false;
  if (Array.isArray(resp.commands) && resp.commands.length > 0) {
    hadCommands = true;
    for (const cmd of resp.commands) {
      await handleCommand(cmd);
    }
  }

  // Check credit usage notifications
  checkCreditNotifications(resp);

  // If we received commands, poll again soon for follow-ups
  if (hadCommands) {
    schedulePoll(10000); // 10 seconds
  }
}

// ══════════════════════════════════════════════════════
// 6. COMMAND HANDLER
// ══════════════════════════════════════════════════════

async function handleCommand(cmd) {
  if (!cmd?.type) return;
  log(`Processing command: ${cmd.type}`);

  switch (cmd.type) {
    case 'upload_logs': {
      const watcherLog = readLogFile(LOG_FILE, UPLOAD_MAX_BYTES);
      const debugLog = readLogFile(DEBUG_LOG_FILE, UPLOAD_MAX_BYTES);
      const result = await postJSON('/api/v1/watcher/logs', {
        watcher_log: watcherLog,
        debug_log: debugLog,
        hostname: hostname(),
        timestamp: new Date().toISOString(),
      });
      log(`Log upload: ${result ? 'success' : 'failed'}`);
      break;
    }

    case 'kill': {
      log('Received kill command from server');
      notify('ClawLens', 'Access revoked by admin');
      try {
        execSync('claude auth logout', { timeout: 5000, stdio: 'ignore' });
        log('Executed claude auth logout');
      } catch (e) {
        log(`claude auth logout failed: ${e.message}`);
      }
      break;
    }

    case 'notify': {
      const message = cmd.message || 'Notification from admin';
      notify('ClawLens', message);
      break;
    }

    default:
      log(`Unknown command type: ${cmd.type}`);
  }
}

// ══════════════════════════════════════════════════════
// 7. CREDIT USAGE NOTIFICATIONS
// ══════════════════════════════════════════════════════

function checkCreditNotifications(resp) {
  // Reset daily tracking
  const today = new Date().toISOString().slice(0, 10);
  if (notifiedCredits.day !== today) {
    notifiedCredits = { day: today, at80: false, at100: false };
  }

  // Check status-based notifications
  if (resp.status === 'killed') {
    notify('ClawLens', 'Access revoked by admin');
    try {
      execSync('claude auth logout', { timeout: 5000, stdio: 'ignore' });
      log('Executed claude auth logout (killed status)');
    } catch (e) {
      log(`claude auth logout failed: ${e.message}`);
    }
    return;
  }

  if (resp.status === 'paused') {
    notify('ClawLens', 'Access paused by admin');
    return;
  }

  // Check credit usage percentage
  const usage = resp.credit_usage;
  if (!usage || typeof usage.percent !== 'number') return;

  if (usage.percent >= 100 && !notifiedCredits.at100) {
    notifiedCredits.at100 = true;
    notifiedCredits.at80 = true; // also mark 80% as done
    notify('ClawLens', 'Daily credit limit reached');
    log(`Credit notification: 100% (${usage.percent}%)`);
  } else if (usage.percent >= 80 && !notifiedCredits.at80) {
    notifiedCredits.at80 = true;
    notify('ClawLens', '80% of daily credit budget used');
    log(`Credit notification: 80% (${usage.percent}%)`);
  }
}

// ══════════════════════════════════════════════════════
// 8. STATUS COMMAND
// ══════════════════════════════════════════════════════

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function formatTimeAgo(timestampMs) {
  if (!timestampMs) return 'never';
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  return `${hours} hours ago`;
}

function renderProgressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

function showStatus() {
  const config = readJSON(CONFIG_FILE);
  let watcherRunning = false;
  let watcherUptime = '';

  // Check PID file
  try {
    const pidStr = readFileSync(PID_FILE, 'utf-8').trim();
    if (pidStr && isProcessAlive(pidStr)) {
      watcherRunning = true;
      // Estimate uptime from config
      if (config?.uptime_seconds) {
        const sinceLastSync = config.last_sync ? Math.floor((Date.now() - config.last_sync) / 1000) : 0;
        watcherUptime = formatUptime(config.uptime_seconds + sinceLastSync);
      }
    }
  } catch {}

  const user = config?.user || 'unknown';
  const model = config?.model || detectModel();
  const status = config?.status || 'unknown';
  const server = config?.server || SERVER_URL || 'not configured';
  const hooksIntact = config?.hooks_intact ?? getHooksIntactCount();
  const hooksTotal = config?.hooks_total ?? HOOK_EVENTS.length;
  const lastSync = formatTimeAgo(config?.last_sync);

  const creditUsage = config?.credit_usage;
  const limits = config?.limits;

  let output = `
ClawLens Status
\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  User:       ${user}
  Model:      ${model}
  Status:     ${status}
  Server:     ${server}
`;

  if (creditUsage && typeof creditUsage.used === 'number' && typeof creditUsage.total === 'number') {
    const pct = creditUsage.percent ?? Math.round((creditUsage.used / creditUsage.total) * 100);
    output += `
  Credits Today:  ${creditUsage.used} / ${creditUsage.total} (${pct}%)
  ${renderProgressBar(pct)}  ${pct}%
`;
  }

  if (limits && typeof limits === 'object') {
    output += '\n  Limits:\n';
    for (const [key, value] of Object.entries(limits)) {
      output += `    ${key}: ${value}\n`;
    }
  }

  output += `
  Watcher:    ${watcherRunning ? `running (uptime ${watcherUptime || 'unknown'})` : 'not running'}
  Hooks:      ${hooksIntact === hooksTotal ? 'intact' : 'DEGRADED'} (${hooksIntact}/${hooksTotal})
  Last sync:  ${lastSync}
`;

  process.stdout.write(output.trimStart());
}

// ══════════════════════════════════════════════════════
// 9. POLL LOOP
// ══════════════════════════════════════════════════════

let pollTimer = null;

function schedulePoll(delayMs) {
  // Cancel any existing scheduled poll
  if (pollTimer) clearTimeout(pollTimer);
  const delay = delayMs ?? pollIntervalMs;
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    try {
      await syncWithServer();
    } catch (e) {
      log(`Sync error: ${e.message}`);
    }
    // Only schedule next regular poll if syncWithServer didn't already
    // schedule a short re-poll (from command processing)
    if (!pollTimer) {
      schedulePoll(pollIntervalMs);
    }
  }, delay);
}

// ══════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════

async function main() {
  // Handle "status" command
  if (process.argv[2] === 'status') {
    loadConfig();
    showStatus();
    process.exit(0);
  }

  // Load configuration
  loadConfig();

  // Check for duplicate instance
  checkDuplicate();

  // Write PID file
  writePidFile();

  // Setup signal handlers for cleanup
  setupSignalHandlers();

  log(`ClawLens Watcher v${VERSION} starting (PID ${process.pid})`);
  log(`SERVER_URL=${SERVER_URL || '(not set)'}`);
  log(`AUTH_TOKEN=${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(not set)'}`);
  log(`Platform=${platform()}, Node=${process.version}`);

  // Start file watcher
  startWatcher();

  // Run initial hook check
  checkAndRepairHooks();

  // Run initial sync
  try {
    await syncWithServer();
  } catch (e) {
    log(`Initial sync error: ${e.message}`);
  }

  // Schedule poll loop
  schedulePoll();

  log('Watcher running — polling and watching for changes');
}

main().catch((e) => {
  log(`FATAL: ${e.stack || e.message}`);
  cleanupPidFile();
  process.exit(1);
});
