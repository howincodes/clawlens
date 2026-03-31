#!/usr/bin/env node

/**
 * ClawLens Comprehensive Diagnostic Tool
 * Zero deps. Cross-platform (macOS, Windows, Linux).
 * Run: node scripts/debug.mjs
 *
 * Tests every component: CC hooks, Codex hooks, AG collector, watcher,
 * server connectivity, auth, subscriptions, debug logs.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { homedir, platform, release, hostname, arch } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// ── Colors (works on all terminals including Windows Terminal) ────────────────

const isCI = !!process.env.CI;
const noColor = !!process.env.NO_COLOR || isCI;

const C = noColor ? { g: '', y: '', r: '', c: '', b: '', d: '', m: '' } : {
  g: '\x1b[32m',    // green
  y: '\x1b[33m',    // yellow
  r: '\x1b[31m',    // red
  c: '\x1b[36m',    // cyan
  b: '\x1b[1m',     // bold
  d: '\x1b[0m',     // reset
  m: '\x1b[90m',    // muted
};

let passCount = 0;
let warnCount = 0;
let failCount = 0;

function ok(msg)   { passCount++; console.log(`  ${C.g}✓${C.d} ${msg}`); }
function warn(msg) { warnCount++; console.log(`  ${C.y}⚠${C.d} ${msg}`); }
function fail(msg) { failCount++; console.log(`  ${C.r}✗${C.d} ${msg}`); }
function info(msg) { console.log(`  ${C.c}→${C.d} ${msg}`); }
function dim(msg)  { console.log(`  ${C.m}  ${msg}${C.d}`); }
function hdr(msg)  { console.log(`\n${C.b}${msg}${C.d}`); }
function divider() { console.log(`${C.m}${'─'.repeat(60)}${C.d}`); }

// ── Helpers ──────────────────────────────────────────────────────────────────

const HOME = homedir();
const OS = platform();

function readJSON(filepath) {
  try {
    return JSON.parse(readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

function fileExists(p) { return existsSync(p); }

function fileSize(p) {
  try { return statSync(p).size; } catch { return 0; }
}

function fileAge(p) {
  try {
    const ms = Date.now() - statSync(p).mtimeMs;
    if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)}h ago`;
    return `${Math.round(ms / 86400000)}d ago`;
  } catch { return 'unknown'; }
}

function tailFile(p, lines = 5) {
  try {
    const content = readFileSync(p, 'utf8');
    const arr = content.trim().split('\n');
    return arr.slice(-lines);
  } catch { return []; }
}

function exec(cmd, timeout = 5000) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

function which(cmd) {
  if (OS === 'win32') {
    return exec(`where ${cmd} 2>nul`).split('\n')[0] || '';
  }
  return exec(`which ${cmd} 2>/dev/null`);
}

function isProcessRunning(pattern) {
  if (OS === 'win32') {
    const out = exec(`powershell -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*${pattern}*' } | Select-Object -First 1 Id | ForEach-Object { $_.Id }"`, 10000);
    return out ? { pid: out.trim() } : null;
  }
  const pid = exec(`pgrep -f "${pattern}" 2>/dev/null`);
  return pid ? { pid: pid.split('\n')[0] } : null;
}

function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch { return null; }
}

async function httpCheck(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { status: resp.status, ok: resp.ok };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

async function testHookEndpoint(serverUrl, token, path, payload) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await resp.text();
    return { status: resp.status, body, ok: resp.ok };
  } catch (e) {
    return { status: 0, body: '', ok: false, error: e.message };
  }
}

// ── Paths ────────────────────────────────────────────────────────────────────

const PATHS = {
  claudeSettings: join(HOME, '.claude', 'settings.json'),
  claudeHooksDir: join(HOME, '.claude', 'hooks'),
  ccHookScript:   join(HOME, '.claude', 'hooks', 'clawlens-hook.sh'),
  ccHookMjs:      join(HOME, '.claude', 'hooks', 'clawlens.mjs'),
  ccDebugLog:     join(HOME, '.claude', 'hooks', '.clawlens-debug.log'),
  ccCache:        join(HOME, '.claude', 'hooks', '.clawlens-cache.json'),
  ccModelCache:   join(HOME, '.claude', 'hooks', '.clawlens-model.txt'),
  watcherMjs:     join(HOME, '.claude', 'hooks', 'clawlens-watcher.mjs'),
  watcherLog:     join(HOME, '.claude', 'hooks', '.clawlens-watcher.log'),
  watcherPid:     join(HOME, '.claude', 'hooks', '.clawlens-watcher.pid'),
  agCollector:    join(HOME, '.claude', 'hooks', 'antigravity-collector.mjs'),
  codexConfig:    join(HOME, '.codex', 'config.toml'),
  codexHooksJson: join(HOME, '.codex', 'hooks.json'),
  codexHooksDir:  join(HOME, '.codex', 'hooks'),
  codexHookMjs:   join(HOME, '.codex', 'hooks', 'clawlens-codex.mjs'),
  codexDebugLog:  join(HOME, '.codex', 'hooks', '.clawlens-codex-debug.log'),
  codexAuth:      join(HOME, '.codex', 'auth.json'),
};

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log(`${C.b}ClawLens Comprehensive Diagnostics${C.d}`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`${C.m}${new Date().toISOString()} | ${OS} ${arch()} | Node ${process.version}${C.d}`);

  // ── 1. System ─────────────────────────────────────────────────────────────

  hdr('1. System Environment');

  info(`OS: ${OS} ${release()}`);
  info(`Hostname: ${hostname()}`);
  info(`Home: ${HOME}`);

  const nodeVer = process.version;
  const nodeMajor = parseInt(nodeVer.slice(1));
  if (nodeMajor >= 18) {
    ok(`Node.js ${nodeVer} (fetch available)`);
  } else {
    fail(`Node.js ${nodeVer} — requires ≥ 18 for native fetch`);
  }

  const claudePath = which('claude');
  if (claudePath) {
    const claudeVer = exec('claude --version 2>&1').split('\n')[0];
    ok(`Claude Code: ${claudeVer}`);
  } else {
    warn('Claude Code CLI not found in PATH');
  }

  const codexPath = which('codex');
  if (codexPath) {
    const codexVer = exec('codex --version 2>&1').split('\n')[0];
    ok(`Codex: ${codexVer}`);
  } else {
    warn('Codex CLI not found in PATH');
  }

  // ── 2. Claude Code Hooks ──────────────────────────────────────────────────

  hdr('2. Claude Code Integration');

  let serverUrl = '';
  let authToken = '';

  // settings.json
  if (fileExists(PATHS.claudeSettings)) {
    ok(`settings.json (${fileAge(PATHS.claudeSettings)})`);

    const settings = readJSON(PATHS.claudeSettings);
    if (settings) {
      // Hooks
      const hookEvents = Object.keys(settings.hooks || {});
      const clawlensHooks = hookEvents.filter(k => JSON.stringify(settings.hooks[k]).includes('clawlens'));

      if (clawlensHooks.length > 0) {
        ok(`Hooks: ${clawlensHooks.length} events → ${clawlensHooks.join(', ')}`);

        // Check for invalid events
        const validEvents = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
          'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop', 'StopFailure',
          'SubagentStart', 'SubagentStop', 'PreCompact', 'PostCompact', 'PermissionRequest',
          'Setup', 'TeammateIdle', 'TaskCompleted', 'Elicitation', 'ElicitationResult',
          'ConfigChange', 'WorktreeCreate', 'WorktreeRemove', 'InstructionsLoaded'];

        const invalidHooks = clawlensHooks.filter(h => !validEvents.includes(h));
        if (invalidHooks.length > 0) {
          fail(`Invalid hook events: ${invalidHooks.join(', ')} — will cause settings parse error`);
        }

        // Check for matcher on events that don't support it
        for (const event of clawlensHooks) {
          const groups = settings.hooks[event] || [];
          for (const group of groups) {
            if (group.matcher && !['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event)) {
              fail(`"${event}" has matcher "${group.matcher}" — only PreToolUse/PostToolUse support matcher`);
            }
          }
        }
      } else {
        fail('No ClawLens hooks in settings.json');
      }

      // Env vars
      serverUrl = settings.env?.CLAUDE_PLUGIN_OPTION_SERVER_URL || settings.env?.CLAWLENS_SERVER || '';
      authToken = settings.env?.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN || settings.env?.CLAWLENS_TOKEN || '';

      if (serverUrl) {
        ok(`Server URL: ${serverUrl}`);
      } else {
        fail('No CLAWLENS_SERVER in env');
      }

      if (authToken) {
        ok(`Auth token: ${authToken.slice(0, 12)}...`);
      } else {
        fail('No CLAWLENS_TOKEN in env');
      }

      // Check for common misconfigs
      if (settings.hooks && !settings.env) {
        fail('Hooks exist but no env block — server URL and token missing');
      }
    } else {
      fail('settings.json exists but failed to parse — check JSON syntax');
    }
  } else {
    fail('settings.json not found');
  }

  // Hook scripts
  const ccFiles = [
    { path: PATHS.ccHookScript, name: 'clawlens-hook.sh' },
    { path: PATHS.ccHookMjs, name: 'clawlens.mjs' },
  ];
  for (const f of ccFiles) {
    if (fileExists(f.path)) {
      ok(`${f.name} (${(fileSize(f.path) / 1024).toFixed(1)}KB, ${fileAge(f.path)})`);
    } else {
      fail(`${f.name} missing`);
    }
  }

  // Cache files
  if (fileExists(PATHS.ccCache)) {
    const cache = readJSON(PATHS.ccCache);
    if (cache) {
      info(`Cache: email=${cache.email || '(none)'}, plan=${cache.subscriptionType || '(none)'}, age=${fileAge(PATHS.ccCache)}`);
    }
  } else {
    info('No subscription cache (will be created on first hook)');
  }

  if (fileExists(PATHS.ccModelCache)) {
    const model = readFileSync(PATHS.ccModelCache, 'utf8').trim();
    info(`Cached model: ${model}`);
  }

  // ── 3. Codex Integration ──────────────────────────────────────────────────

  hdr('3. OpenAI Codex Integration');

  if (codexPath) {
    const codexVerStr = exec('codex --version 2>&1');
    const verMatch = codexVerStr.match(/(\d+\.\d+\.\d+)/);
    const ver = verMatch ? verMatch[1] : '0.0.0';
    const [major, minor, patch] = ver.split('.').map(Number);
    const verNum = major * 10000 + minor * 100 + patch;

    if (verNum >= 1170) {
      ok(`Version ${ver} ≥ 0.117.0 (hooks supported)`);
    } else {
      fail(`Version ${ver} < 0.117.0 — hooks NOT supported. Run: npm update -g @openai/codex`);
    }

    // config.toml
    if (fileExists(PATHS.codexConfig)) {
      ok('config.toml exists');
      const toml = readFileSync(PATHS.codexConfig, 'utf8');
      if (/codex_hooks\s*=\s*true/.test(toml)) {
        ok('codex_hooks = true');
      } else {
        fail('codex_hooks not enabled — add [features] codex_hooks = true');
      }

      // Check features list
      const features = exec('codex features list 2>&1');
      const hookLine = features.split('\n').find(l => l.includes('codex_hooks'));
      if (hookLine) {
        info(`Feature flag: ${hookLine.trim()}`);
      }
    } else {
      warn('config.toml not found');
    }

    // hooks.json
    if (fileExists(PATHS.codexHooksJson)) {
      ok('hooks.json exists');
      const hooksJson = readJSON(PATHS.codexHooksJson);
      if (hooksJson) {
        const events = Object.keys(hooksJson.hooks || hooksJson);
        ok(`Hook events: ${events.join(', ')}`);

        // Validate format — must have nested {hooks: {EventName: [{hooks: [...]}]}}
        if (hooksJson.hooks) {
          for (const [event, groups] of Object.entries(hooksJson.hooks)) {
            const group = groups[0];
            if (!group?.hooks || !Array.isArray(group.hooks)) {
              fail(`${event}: wrong format — needs [{hooks: [{type:"command",...}]}]`);
            } else {
              const hook = group.hooks[0];
              if (!hook?.command?.includes('clawlens-codex')) {
                warn(`${event}: command doesn't point to clawlens-codex.mjs`);
              }
            }
          }
        } else {
          fail('hooks.json missing top-level "hooks" key — Codex will silently ignore');
        }
      } else {
        fail('hooks.json parse error — check JSON syntax');
      }
    } else {
      warn('hooks.json not found');
    }

    // Hook script
    if (fileExists(PATHS.codexHookMjs)) {
      ok(`clawlens-codex.mjs (${(fileSize(PATHS.codexHookMjs) / 1024).toFixed(1)}KB, ${fileAge(PATHS.codexHookMjs)})`);
    } else {
      warn('clawlens-codex.mjs missing — run install.sh');
    }

    // Auth
    if (fileExists(PATHS.codexAuth)) {
      const auth = readJSON(PATHS.codexAuth);
      if (auth?.tokens?.id_token) {
        const jwt = decodeJwtPayload(auth.tokens.id_token);
        if (jwt) {
          const oai = jwt['https://api.openai.com/auth'] || {};
          ok(`Auth: ${jwt.email} (${oai.chatgpt_plan_type || 'unknown'} plan)`);
          info(`Provider: ${jwt.auth_provider || 'unknown'}`);
          info(`Account: ${oai.chatgpt_account_id?.slice(0, 12) || 'unknown'}...`);
          info(`Sub active: ${oai.chatgpt_subscription_active_start || '?'} → ${oai.chatgpt_subscription_active_until || '?'}`);
          const orgs = oai.organizations || [];
          if (orgs.length > 0) {
            info(`Org: ${orgs[0].title} (${orgs[0].role})`);
          }
        } else {
          warn('auth.json has id_token but JWT decode failed');
        }
      } else if (auth?.tokens) {
        warn('auth.json exists but no id_token — subscription data unavailable');
      } else {
        warn('auth.json exists but unexpected format');
      }
    } else {
      warn('auth.json not found — run: codex login');
    }
  } else {
    info('Codex not installed — skipping');
  }

  // ── 4. Watcher ────────────────────────────────────────────────────────────

  hdr('4. Watcher Daemon');

  if (fileExists(PATHS.watcherMjs)) {
    ok(`clawlens-watcher.mjs (${(fileSize(PATHS.watcherMjs) / 1024).toFixed(1)}KB)`);
  } else {
    fail('clawlens-watcher.mjs missing');
  }

  const watcher = isProcessRunning('clawlens-watcher');
  if (watcher) {
    ok(`Running (pid ${watcher.pid})`);
    if (OS !== 'win32') {
      const uptime = exec(`ps -p ${watcher.pid} -o etime= 2>/dev/null`).trim();
      if (uptime) info(`Uptime: ${uptime}`);
    }
  } else {
    fail('NOT running');
  }

  // PID file
  if (fileExists(PATHS.watcherPid)) {
    const pidContent = readFileSync(PATHS.watcherPid, 'utf8').trim();
    info(`PID file: ${pidContent} (${fileAge(PATHS.watcherPid)})`);
    if (watcher && pidContent !== watcher.pid) {
      warn(`PID mismatch: file says ${pidContent}, actual is ${watcher.pid}`);
    }
  }

  // LaunchAgent (macOS)
  if (OS === 'darwin') {
    const launchAgent = join(HOME, 'Library', 'LaunchAgents', 'com.clawlens.watcher.plist');
    if (fileExists(launchAgent)) {
      ok('macOS LaunchAgent installed');
    } else {
      warn('macOS LaunchAgent not found — watcher won\'t auto-start on login');
    }
  }

  // ── 5. Antigravity ────────────────────────────────────────────────────────

  hdr('5. Antigravity Collector');

  if (fileExists(PATHS.agCollector)) {
    ok(`antigravity-collector.mjs (${(fileSize(PATHS.agCollector) / 1024).toFixed(1)}KB)`);
  } else {
    warn('antigravity-collector.mjs missing');
  }

  // Check for running LS
  let agLsPattern = '';
  if (OS === 'darwin') agLsPattern = 'language_server_macos';
  else if (OS === 'linux') agLsPattern = 'language_server_linux';
  else if (OS === 'win32') agLsPattern = 'language_server';

  if (agLsPattern) {
    const agProc = isProcessRunning(agLsPattern);
    if (agProc) {
      ok(`Antigravity LS running (pid ${agProc.pid})`);
    } else {
      info('Antigravity LS not running (IDE may be closed — this is normal)');
    }
  }

  // ── 6. Server Connectivity ────────────────────────────────────────────────

  hdr('6. Server Connectivity');

  // Try to find server URL from multiple sources
  if (!serverUrl) {
    // Try Codex hooks.json
    if (fileExists(PATHS.codexHooksJson)) {
      const hj = readJSON(PATHS.codexHooksJson);
      const cmd = hj?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command || '';
      const m = cmd.match(/CLAWLENS_SERVER=(\S+)/);
      if (m) serverUrl = m[1];
    }
  }

  if (!serverUrl) {
    fail('No server URL found in any config');
  } else {
    // Health check
    const health = await httpCheck(`${serverUrl}/health`);
    if (health.ok) {
      ok(`Health: ${serverUrl}/health → ${health.status}`);
    } else if (health.status > 0) {
      warn(`Health: ${serverUrl}/health → HTTP ${health.status}`);
    } else {
      fail(`Health: ${serverUrl}/health → ${health.error || 'unreachable'}`);
    }

    // API health
    const apiHealth = await httpCheck(`${serverUrl}/api/v1/health`);
    if (apiHealth.ok) {
      ok(`API: ${serverUrl}/api/v1/health → ${apiHealth.status}`);
    } else {
      warn(`API: ${serverUrl}/api/v1/health → ${apiHealth.status || apiHealth.error}`);
    }

    // Test CC hook endpoint
    if (authToken) {
      info('Testing hook endpoints...');

      const ccTest = await testHookEndpoint(serverUrl, authToken, '/api/v1/hook/session-start', {
        hook_event_name: 'SessionStart',
        session_id: `diag-cc-${Date.now()}`,
        model: 'diagnostic-test',
      });
      if (ccTest.ok) {
        ok(`CC SessionStart → ${ccTest.status} ${ccTest.body.slice(0, 80)}`);
      } else if (ccTest.status === 401) {
        fail(`CC SessionStart → 401 Unauthorized — check auth token`);
      } else {
        fail(`CC SessionStart → ${ccTest.status || ccTest.error}`);
      }

      const codexTest = await testHookEndpoint(serverUrl, authToken, '/api/v1/codex/session-start', {
        hook_event_name: 'SessionStart',
        session_id: `diag-codex-${Date.now()}`,
        model: 'diagnostic-test',
      });
      if (codexTest.ok) {
        ok(`Codex SessionStart → ${codexTest.status} ${codexTest.body.slice(0, 80)}`);
      } else if (codexTest.status === 401) {
        fail(`Codex SessionStart → 401 Unauthorized — check auth token`);
      } else {
        fail(`Codex SessionStart → ${codexTest.status || codexTest.error}`);
      }
    } else {
      warn('Skipping endpoint tests — no auth token');
    }
  }

  // ── 7. Debug Logs ─────────────────────────────────────────────────────────

  hdr('7. Debug Logs');

  const logs = [
    { path: PATHS.ccDebugLog, name: 'Claude Code Hook' },
    { path: PATHS.codexDebugLog, name: 'Codex Hook' },
    { path: PATHS.watcherLog, name: 'Watcher' },
  ];

  for (const log of logs) {
    console.log('');
    console.log(`  ${C.c}── ${log.name} ──${C.d}`);
    if (fileExists(log.path)) {
      const size = fileSize(log.path);
      const lines = readFileSync(log.path, 'utf8').split('\n').length;
      info(`${(size / 1024).toFixed(1)}KB, ${lines} lines, last modified ${fileAge(log.path)}`);

      // Show last 8 lines
      const tail = tailFile(log.path, 8);
      for (const line of tail) {
        // Colorize based on content
        if (line.includes('ERROR') || line.includes('FAILED') || line.includes('TIMEOUT')) {
          dim(`${C.r}${line}${C.d}`);
        } else if (line.includes('BLOCKED') || line.includes('killed')) {
          dim(`${C.y}${line}${C.d}`);
        } else {
          dim(line);
        }
      }

      // Count errors/timeouts
      const content = readFileSync(log.path, 'utf8');
      const errorCount = (content.match(/ERROR|FAILED/gi) || []).length;
      const timeoutCount = (content.match(/TIMEOUT/gi) || []).length;
      const blockCount = (content.match(/BLOCKED/gi) || []).length;
      if (errorCount > 0 || timeoutCount > 0) {
        warn(`${errorCount} errors, ${timeoutCount} timeouts, ${blockCount} blocks in log`);
      }
    } else {
      info('No log file (no events recorded yet)');
    }
  }

  // ── 8. Data Integrity ─────────────────────────────────────────────────────

  hdr('8. Configuration Integrity');

  // Check if CC and Codex hooks point to the same server
  if (fileExists(PATHS.codexHooksJson) && serverUrl) {
    const hj = readJSON(PATHS.codexHooksJson);
    const cmd = hj?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command || '';
    const m = cmd.match(/CLAWLENS_SERVER=(\S+)/);
    const codexServer = m ? m[1] : '';
    if (codexServer && codexServer !== serverUrl) {
      warn(`Server mismatch: CC → ${serverUrl}, Codex → ${codexServer}`);
    } else if (codexServer) {
      ok('CC and Codex point to same server');
    }

    // Check token matches
    const tm = cmd.match(/CLAWLENS_TOKEN=(\S+)/);
    const codexToken = tm ? tm[1] : '';
    if (codexToken && authToken && codexToken !== authToken) {
      warn(`Token mismatch: CC and Codex use different auth tokens`);
    } else if (codexToken && authToken) {
      ok('CC and Codex use same auth token');
    }
  }

  // Check if clawlens-codex.mjs is up to date with the repo version
  if (fileExists(PATHS.codexHookMjs)) {
    const deployed = fileSize(PATHS.codexHookMjs);
    const repoPath = join(process.cwd(), 'client', 'clawlens-codex.mjs');
    if (fileExists(repoPath)) {
      const repo = fileSize(repoPath);
      if (deployed !== repo) {
        warn(`clawlens-codex.mjs may be outdated (deployed=${deployed}B, repo=${repo}B)`);
        info(`Update: cp client/clawlens-codex.mjs ~/.codex/hooks/`);
      } else {
        ok('clawlens-codex.mjs matches repo version');
      }
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  hdr('Summary');
  divider();
  console.log(`  ${C.g}${passCount} passed${C.d}  ${C.y}${warnCount} warnings${C.d}  ${C.r}${failCount} failures${C.d}`);

  if (failCount > 0) {
    console.log(`\n  ${C.r}${C.b}Action needed:${C.d} Fix the ${failCount} failure(s) above.`);
  } else if (warnCount > 0) {
    console.log(`\n  ${C.y}Mostly good.${C.d} Review ${warnCount} warning(s) above.`);
  } else {
    console.log(`\n  ${C.g}${C.b}All systems go.${C.d}`);
  }
  console.log('');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`\n${C.r}Diagnostic tool crashed: ${e.message}${C.d}`);
  console.error(e.stack);
  process.exit(2);
});
