#!/usr/bin/env node

// ClawLens Codex Hook Handler
// Reads Codex hook JSON from stdin, enriches it, POSTs to server.
// Returns server response to stdout (for blocking decisions).
// Fails open on any error — never breaks Codex.

import { readFileSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname, platform, release } from 'os';

// ── Debug logging ───────────────────────────────────
const VERSION = '1.0.0';
const HOME = homedir();
const CODEX_DIR = join(HOME, '.codex');
const HOOKS_DIR = join(CODEX_DIR, 'hooks');
const LOG_FILE = join(HOOKS_DIR, '.clawlens-codex-debug.log');

function debug(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ── Configuration ────────────────────────────────────
const SERVER_URL = process.env.CLAWLENS_SERVER || '';
const AUTH_TOKEN = process.env.CLAWLENS_TOKEN || '';

debug(`──── ClawLens Codex hook v${VERSION} starting ────`);
debug(`SERVER_URL=${SERVER_URL || '(empty)'}`);
debug(`AUTH_TOKEN=${AUTH_TOKEN ? AUTH_TOKEN.slice(0, 8) + '...' : '(empty)'}`);
debug(`Node ${process.version}, platform=${platform()}, cwd=${process.cwd()}`);

if (!SERVER_URL || !AUTH_TOKEN) {
  debug('EXITING: missing SERVER_URL or AUTH_TOKEN — nothing to do');
  process.exit(0);
}

// ── Event → API path ────────────────────────────────
const EVENT_PATHS = {
  SessionStart: 'session-start',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'pre-tool-use',
  PostToolUse: 'post-tool-use',
  Stop: 'stop',
};

// ── Read stdin ───────────────────────────────────────
function readStdin() {
  debug('readStdin: reading fd 0...');
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

// ── JWT decode ───────────────────────────────────────
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      debug(`decodeJwtPayload: invalid JWT — ${parts.length} parts`);
      return null;
    }
    // base64url → base64 → Buffer → JSON
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // Pad to multiple of 4
    while (payload.length % 4 !== 0) payload += '=';
    const json = Buffer.from(payload, 'base64').toString('utf-8');
    const parsed = JSON.parse(json);
    debug(`decodeJwtPayload: decoded OK — keys: ${Object.keys(parsed).join(', ')}`);
    return parsed;
  } catch (e) {
    debug(`decodeJwtPayload: FAILED — ${e.message}`);
    return null;
  }
}

// ── SessionStart enrichment ──────────────────────────
function enrichSessionStart(data) {
  debug('enrichSessionStart: enriching session data...');
  const enriched = { ...data };

  // Decode auth.json JWT for subscription info
  const authPath = join(CODEX_DIR, 'auth.json');
  try {
    const authRaw = readFileSync(authPath, 'utf-8');
    const authJson = JSON.parse(authRaw);
    debug(`enrichSessionStart: auth.json keys: ${Object.keys(authJson).join(', ')}`);

    const idToken = authJson.id_token;
    if (idToken) {
      const jwt = decodeJwtPayload(idToken);
      if (jwt) {
        // email is at the top level
        enriched.subscription_email = jwt.email || '';

        // OpenAI auth data is nested under namespace key
        const auth = jwt['https://api.openai.com/auth'] || {};
        debug(`enrichSessionStart: auth namespace keys: ${Object.keys(auth).join(', ')}`);

        enriched.plan_type = auth.chatgpt_plan_type || '';
        enriched.auth_provider = jwt.auth_provider || auth.auth_provider || '';
        enriched.account_id = auth.chatgpt_account_id || '';
        enriched.openai_user_id = auth.chatgpt_user_id || '';
        enriched.subscription_active_start = auth.chatgpt_subscription_active_start || '';
        enriched.subscription_active_until = auth.chatgpt_subscription_active_until || '';

        // Extract org info from first default organization
        const orgs = auth.organizations || [];
        const defaultOrg = orgs.find((o) => o.is_default) || orgs[0];
        if (defaultOrg) {
          enriched.org_id = defaultOrg.id || '';
          enriched.org_title = defaultOrg.title || '';
        }

        debug(`enrichSessionStart: email=${enriched.subscription_email}, plan=${enriched.plan_type}, org=${enriched.org_title || '(none)'}`);
      }
    } else {
      debug('enrichSessionStart: no id_token in auth.json');
    }
  } catch (e) {
    debug(`enrichSessionStart: auth.json read failed — ${e.message}`);
  }

  // Extract session metadata from transcript if available
  if (data.transcript_path) {
    try {
      const transcriptPath = data.transcript_path.replace(/^~/, HOME);
      const transcriptRaw = readFileSync(transcriptPath, 'utf-8');
      const lines = transcriptRaw.trim().split('\n');
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'session_meta' || entry.type === 'config') {
            if (entry.cli_version) enriched.cli_version = entry.cli_version;
            if (entry.model_provider) enriched.model_provider = entry.model_provider;
            if (entry.reasoning_effort) enriched.reasoning_effort = entry.reasoning_effort;
            debug(`enrichSessionStart: transcript meta — cli_version=${entry.cli_version}, model_provider=${entry.model_provider}`);
            break;
          }
        } catch {}
      }
    } catch (e) {
      debug(`enrichSessionStart: transcript read failed — ${e.message}`);
    }
  }

  // Device info
  enriched.hostname = hostname();
  enriched.platform = platform();
  enriched.os_version = release();
  enriched.node_version = process.version;

  debug(`enrichSessionStart: done — model=${enriched.model}, hostname=${enriched.hostname}`);
  return enriched;
}

// ── Stop enrichment (token counts from transcript) ───
function enrichStop(data) {
  debug('enrichStop: enriching stop data...');
  const enriched = { ...data };

  // transcript_path may come from the Stop payload or may not be present
  const transcriptPath = (data.transcript_path || '').replace(/^~/, HOME);
  if (!transcriptPath) {
    debug('enrichStop: no transcript_path in payload — skipping token enrichment');
    return enriched;
  }

  try {
    const raw = readFileSync(transcriptPath, 'utf-8');
    const lines = raw.trim().split('\n');

    // Find the LAST token_count entry
    let lastTokenEntry = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.type === 'token_count') {
          lastTokenEntry = entry;
          break;
        }
      } catch {}
    }

    if (!lastTokenEntry) {
      debug('enrichStop: no token_count entry found in transcript');
      return enriched;
    }

    debug(`enrichStop: found token_count entry`);

    // Extract total token usage
    const usage = lastTokenEntry.info?.total_token_usage || {};
    enriched.input_tokens = usage.input_tokens || 0;
    enriched.cached_tokens = usage.cached_input_tokens || 0;
    enriched.output_tokens = usage.output_tokens || 0;
    enriched.reasoning_tokens = usage.reasoning_output_tokens || 0;
    enriched.total_tokens = usage.total_tokens || 0;

    debug(`enrichStop: tokens — input=${enriched.input_tokens}, cached=${enriched.cached_tokens}, output=${enriched.output_tokens}, reasoning=${enriched.reasoning_tokens}, total=${enriched.total_tokens}`);

    // Extract rate limits
    const rateLimits = lastTokenEntry.rate_limits || {};

    if (rateLimits.primary) {
      enriched.quota_primary_used_percent = rateLimits.primary.used_percent;
      enriched.quota_primary_window_minutes = rateLimits.primary.window_minutes;
      enriched.quota_primary_resets_at = rateLimits.primary.resets_at;
      debug(`enrichStop: primary quota — ${rateLimits.primary.used_percent}% used, resets_at=${rateLimits.primary.resets_at}`);
    }

    if (rateLimits.secondary) {
      enriched.quota_secondary_used_percent = rateLimits.secondary.used_percent;
      enriched.quota_secondary_window_minutes = rateLimits.secondary.window_minutes;
      enriched.quota_secondary_resets_at = rateLimits.secondary.resets_at;
      debug(`enrichStop: secondary quota — ${rateLimits.secondary.used_percent}% used`);
    }

    if (rateLimits.plan_type) {
      enriched.quota_plan_type = rateLimits.plan_type;
      debug(`enrichStop: plan_type=${rateLimits.plan_type}`);
    }
  } catch (e) {
    debug(`enrichStop: transcript read failed — ${e.message}`);
  }

  return enriched;
}

// ── POST to server ───────────────────────────────────
async function postToServer(path, payload) {
  const url = `${SERVER_URL.replace(/\/$/, '')}/api/v1/codex/${path}`;
  debug(`postToServer: POST ${url}`);
  debug(`postToServer: payload keys: ${Object.keys(payload).join(', ')}`);
  debug(`postToServer: payload size: ${JSON.stringify(payload).length} bytes`);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    debug('postToServer: TIMEOUT after 3000ms — aborting');
    controller.abort();
  }, 3000);

  try {
    const start = Date.now();
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    debug(`postToServer: response status=${resp.status} (${resp.statusText}) in ${elapsed}ms`);

    const text = await resp.text();
    debug(`postToServer: response body (${text.length} chars): ${text.slice(0, 500)}`);

    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  } catch (e) {
    clearTimeout(timer);
    debug(`postToServer: FAILED — ${e.name}: ${e.message}`);
    return {};
  }
}

// ── Main ─────────────────────────────────────────────
async function main() {
  const data = readStdin();
  if (!data?.hook_event_name) {
    debug('EXITING: no hook_event_name in stdin data');
    process.stdout.write('{}');
    process.exit(0);
  }

  const event = data.hook_event_name;
  const apiPath = EVENT_PATHS[event];
  debug(`main: event="${event}" → apiPath="${apiPath || '(unknown)'}"`);
  debug(`main: session_id=${data.session_id || '(none)'}`);

  if (!apiPath) {
    debug(`EXITING: unknown event "${event}" — not in EVENT_PATHS`);
    process.stdout.write('{}');
    process.exit(0);
  }

  // Enrich per event type
  let payload;
  if (event === 'SessionStart') {
    payload = enrichSessionStart(data);
  } else if (event === 'Stop') {
    payload = enrichStop(data);
  } else {
    // UserPromptSubmit, PreToolUse, PostToolUse — pass through as-is
    payload = data;
  }

  const result = await postToServer(apiPath, payload);

  // Hard kill: run `codex logout` before exiting
  if (result.killed && result.hard) {
    debug('main: HARD KILL — running codex logout');
    try {
      const { execSync } = await import('child_process');
      execSync('codex logout', { timeout: 5000, stdio: 'ignore' });
      debug('main: codex logout completed');
    } catch (e) {
      debug(`main: codex logout failed — ${e.message}`);
    }
  }

  const output = JSON.stringify(result);
  debug(`main: writing response to stdout: ${output.slice(0, 200)}`);
  process.stdout.write(output);

  debug('──── ClawLens Codex hook done ────');
}

main().catch((e) => {
  try { debug(`FATAL: main() threw: ${e.stack || e.message}`); } catch {}
  process.stdout.write('{}');
  process.exit(0);
});
