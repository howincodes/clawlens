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
