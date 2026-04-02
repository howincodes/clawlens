#!/usr/bin/env node

// HowinLens Hook Handler
// Reads Claude Code hook JSON from stdin, POSTs to server, returns response.
// Thin by design — all enrichment, model detection, and data collection
// happens server-side (via adapters) or client-side (via Electron).
// Fails open on any error — never breaks Claude Code.

import { readFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ── Configuration ───────────────────────────────────
const VERSION = '2.0.0';
const HOME = homedir();
const HOOKS_DIR = join(HOME, '.claude', 'hooks');
const LOG_FILE = join(HOOKS_DIR, '.howinlens-debug.log');
const DEBUG = process.env.HOWINLENS_DEBUG === '1' || process.env.HOWINLENS_DEBUG === 'true';

const SERVER_URL = process.env.HOWINLENS_SERVER
  || process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL
  || process.env.CLAWLENS_SERVER || '';

const AUTH_TOKEN = process.env.HOWINLENS_TOKEN
  || process.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN
  || process.env.CLAWLENS_TOKEN || '';

// ── Debug logging ───────────────────────────────────
function debug(msg) {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { process.stderr.write(line + '\n'); } catch {}
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

debug(`── HowinLens hook v${VERSION} ──`);
debug(`SERVER_URL=${SERVER_URL || '(empty)'}`);
debug(`AUTH_TOKEN=${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(empty)'}`);

if (!SERVER_URL || !AUTH_TOKEN) {
  debug('EXITING: missing SERVER_URL or AUTH_TOKEN');
  process.exit(0);
}

// ── Event → API path mapping ────────────────────────
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
  CwdChanged: 'cwd-changed',
};

// ── Read stdin ──────────────────────────────────────
function readStdin() {
  try {
    const raw = readFileSync(0, 'utf-8').trim();
    debug(`stdin: ${raw.length} chars, event=${JSON.parse(raw).hook_event_name}`);
    return JSON.parse(raw);
  } catch (e) {
    debug(`stdin read failed: ${e.message}`);
    return null;
  }
}

// ── POST to server ──────────────────────────────────
async function postToServer(apiPath, body) {
  const url = `${SERVER_URL.replace(/\/$/, '')}/api/v1/providers/claude-code/${apiPath}`;
  debug(`POST ${url}`);

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
    debug(`response: ${resp.status} (${text.length} chars)`);
    return text || '';
  } catch (e) {
    clearTimeout(timer);
    debug(`POST failed: ${e.message}`);
    return '';
  }
}

// ── Main ────────────────────────────────────────────
async function main() {
  const data = readStdin();
  if (!data?.hook_event_name) {
    debug('no hook_event_name — exiting');
    process.exit(0);
  }

  const event = data.hook_event_name;
  const apiPath = EVENT_PATHS[event];
  debug(`event="${event}" → path="${apiPath || '(unknown)'}"`);

  if (!apiPath) {
    debug(`unknown event "${event}" — exiting`);
    process.exit(0);
  }

  // Send raw hook data to server — server handles all enrichment via adapters
  const response = await postToServer(apiPath, data);

  if (response) {
    debug(`stdout: ${response.slice(0, 200)}`);
    process.stdout.write(response);
  }

  debug('── done ──');
}

main().catch((e) => {
  debug(`FATAL: ${e.message}`);
  process.exit(0); // fail open
});
