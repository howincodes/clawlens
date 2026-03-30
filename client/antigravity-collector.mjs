#!/usr/bin/env node

// ClawLens Antigravity Collector
// Standalone Node.js replacement for the Python aghistory tool.
// Zero dependencies — Node 18+ built-ins only.
//
// Usage:
//   node antigravity-collector.mjs              → export today's conversations as JSON to stdout
//   node antigravity-collector.mjs --all        → export all conversations
//   node antigravity-collector.mjs --full       → include all extended fields (thinking, diff, output)
//   node antigravity-collector.mjs --thinking   → include thinking + timestamps
//   node antigravity-collector.mjs --test       → test connection only
//
// Importable:
//   import { collectAntigravityConversations } from './antigravity-collector.mjs';

import { execSync } from 'child_process';
import https from 'https';
import { platform } from 'os';

// ════════════════════════════════════════════════════════
// 1. PROCESS DISCOVERY
// ════════════════════════════════════════════════════════

/**
 * Discover running Antigravity LanguageServer processes.
 * Returns: [{ pid: number, csrf: string, cmd: string }, ...]
 */
function discoverLanguageServers() {
  const os = platform();
  if (os === 'darwin') return discoverMacOS();
  if (os === 'win32') return discoverWindows();
  if (os === 'linux') return discoverLinux();
  return [];
}

function discoverMacOS() {
  const servers = [];
  try {
    const pids = execSync('pgrep -f language_server_macos', {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    for (const pid of pids.split('\n')) {
      if (!pid.trim()) continue;
      try {
        const cmd = execSync(`ps -p ${pid} -o args=`, {
          encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const csrf = extractCsrf(cmd);
        servers.push({ pid: parseInt(pid, 10), csrf, cmd });
      } catch { /* process may have exited */ }
    }
  } catch { /* pgrep returns 1 when no matches */ }
  return servers;
}

function discoverLinux() {
  const servers = [];
  try {
    const pids = execSync('pgrep -f language_server_linux', {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    for (const pid of pids.split('\n')) {
      if (!pid.trim()) continue;
      try {
        const cmd = execSync(`ps -p ${pid} -o args=`, {
          encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const csrf = extractCsrf(cmd);
        servers.push({ pid: parseInt(pid, 10), csrf, cmd });
      } catch { /* process may have exited */ }
    }
  } catch { /* pgrep returns 1 when no matches */ }
  return servers;
}

function discoverWindows() {
  const servers = [];
  try {
    const raw = execSync(
      'powershell -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -like \'language_server*\' } | Select-Object ProcessId, CommandLine | ConvertTo-Json"',
      { encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (!raw) return servers;
    let data = JSON.parse(raw);
    if (!Array.isArray(data)) data = [data];
    for (const proc of data) {
      const cmd = proc.CommandLine || '';
      const pid = proc.ProcessId;
      if (!cmd) continue;
      const csrf = extractCsrf(cmd);
      servers.push({ pid, csrf, cmd });
    }
  } catch { /* WMI query failed */ }
  return servers;
}

function extractCsrf(cmdLine) {
  const m = cmdLine.match(/--csrf_token\s+(\S+)/);
  return m ? m[1] : '';
}

// ════════════════════════════════════════════════════════
// 2. PORT DISCOVERY
// ════════════════════════════════════════════════════════

/**
 * Find listening ports for a given PID.
 * Returns: number[]
 */
function findPorts(pid) {
  const os = platform();
  if (os === 'darwin' || os === 'linux') return findPortsUnix(pid);
  if (os === 'win32') return findPortsWindows(pid);
  return [];
}

function findPortsUnix(pid) {
  const ports = [];
  try {
    const output = execSync(`lsof -a -p ${pid} -i -P -n`, {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split('\n')) {
      if (line.includes('LISTEN')) {
        const m = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (m) ports.push(parseInt(m[1], 10));
      }
    }
  } catch { /* lsof may fail if process is gone */ }
  return ports;
}

function findPortsWindows(pid) {
  const ports = [];
  try {
    const output = execSync('netstat -ano', {
      encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of output.split('\n')) {
      if (line.includes('LISTENING') && line.includes(String(pid))) {
        const m = line.match(/127\.0\.0\.1:(\d+)/);
        if (m) ports.push(parseInt(m[1], 10));
      }
    }
  } catch { /* netstat may fail */ }
  return ports;
}

// ════════════════════════════════════════════════════════
// 3. API CLIENT
// ════════════════════════════════════════════════════════

const BASE_PATH = 'exa.language_server_pb.LanguageServerService';

/**
 * Call the LanguageServer gRPC-Web API.
 * Returns parsed JSON response, or null on failure.
 */
function callApi(port, csrfToken, method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(params);
    const options = {
      hostname: 'localhost',
      port,
      path: `/${BASE_PATH}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken,
        'Content-Length': Buffer.byteLength(body),
      },
      rejectAuthorized: false,
      // Node's https agent option for self-signed certs
    };

    const agent = new https.Agent({ rejectUnauthorized: false });

    const timer = setTimeout(() => {
      req.destroy();
      resolve(null);
    }, timeoutMs);

    const req = https.request({ ...options, agent }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        } else {
          resolve(null);
        }
      });
    });

    req.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

/**
 * Get the model placeholder → real label mapping from GetUserStatus.
 * Returns: { MODEL_PLACEHOLDER_M37: "Gemini 3.1 Pro (High)", ... }
 */
async function getModelMapping(port, csrf) {
  const result = await callApi(port, csrf, 'GetUserStatus', {});
  if (!result?.userStatus?.cascadeModelConfigData?.clientModelConfigs) return {};
  const mapping = {};
  for (const config of result.userStatus.cascadeModelConfigData.clientModelConfigs) {
    const placeholder = config.modelOrAlias?.model;
    const label = config.label;
    if (placeholder && label) mapping[placeholder] = label;
  }
  return mapping;
}

/**
 * Get all conversation summaries from a single LS instance.
 */
async function getAllTrajectories(port, csrf) {
  const result = await callApi(port, csrf, 'GetAllCascadeTrajectories', {}, 5000);
  if (!result) return {};
  return result.trajectorySummaries || {};
}

/**
 * Get steps for a single conversation.
 */
async function getTrajectorySteps(port, csrf, cascadeId, stepCount = 1000) {
  const result = await callApi(
    port, csrf, 'GetCascadeTrajectorySteps',
    { cascadeId, startIndex: 0, endIndex: stepCount + 10 },
    30000,
  );
  if (!result) return [];
  return result.steps || result.messages || [];
}

// ════════════════════════════════════════════════════════
// 4. ENDPOINT DISCOVERY (find working port+csrf pairs)
// ════════════════════════════════════════════════════════

/**
 * Find all working endpoints by probing each server's ports.
 * Returns: [{ port, csrf, pid }, ...]
 */
async function findAllEndpoints(servers) {
  const endpoints = [];
  const seenPorts = new Set();

  for (const srv of servers) {
    const ports = findPorts(srv.pid);
    for (const port of ports) {
      if (seenPorts.has(port)) continue;
      const result = await callApi(port, srv.csrf, 'GetAllCascadeTrajectories', {}, 5000);
      if (result !== null) {
        endpoints.push({ port, csrf: srv.csrf, pid: srv.pid });
        seenPorts.add(port);
        break; // one working port per process is enough
      }
    }
  }

  return endpoints;
}

/**
 * Query all LS instances and merge/deduplicate conversation summaries.
 * Returns: { summaries: { cascadeId: summary }, cascadeToEndpoint: { cascadeId: { port, csrf } } }
 */
async function getAllTrajectoriesMerged(endpoints) {
  const merged = {};
  const cascadeEp = {};

  // Fetch in parallel
  const results = await Promise.allSettled(
    endpoints.map(async (ep) => {
      const summaries = await getAllTrajectories(ep.port, ep.csrf);
      return { ep, summaries };
    }),
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { ep, summaries } = result.value;
    for (const [cid, info] of Object.entries(summaries)) {
      if (!(cid in merged)) {
        merged[cid] = info;
        cascadeEp[cid] = { port: ep.port, csrf: ep.csrf };
      }
    }
  }

  return { summaries: merged, cascadeToEndpoint: cascadeEp };
}

// ════════════════════════════════════════════════════════
// 5. STEP PARSER (mirrors Python parser.py exactly)
// ════════════════════════════════════════════════════════

// Field levels
const LEVEL_DEFAULT = 'default';
const LEVEL_THINKING = 'thinking';
const LEVEL_FULL = 'full';

/**
 * Parse raw API steps into structured messages.
 * Exact port of Python parser.py — supports 10 content types, skips 4 system types.
 */
function parseSteps(steps, level = LEVEL_DEFAULT, modelMapping = {}) {
  const includeThinking = level === LEVEL_THINKING || level === LEVEL_FULL;
  const includeFull = level === LEVEL_FULL;

  const messages = [];
  for (const step of steps) {
    const stepType = step.type || '';
    const metadata = step.metadata || {};
    const timestamp = includeThinking ? (metadata.createdAt || null) : null;

    const msg = parseStep(step, stepType, includeThinking, includeFull, modelMapping);
    if (msg === null) continue;

    if (timestamp) msg.timestamp = timestamp;
    messages.push(msg);
  }
  return messages;
}

function parseStep(step, stepType, includeThinking, includeFull, modelMapping = {}) {
  switch (stepType) {
    case 'CORTEX_STEP_TYPE_USER_INPUT':
      return parseUserInput(step, includeFull);

    case 'CORTEX_STEP_TYPE_PLANNER_RESPONSE':
      return parsePlannerResponse(step, includeThinking, includeFull, modelMapping);

    case 'CORTEX_STEP_TYPE_CODE_ACTION':
      return parseCodeAction(step, includeFull);

    case 'CORTEX_STEP_TYPE_RUN_COMMAND':
      return parseRunCommand(step, includeThinking, includeFull);

    case 'CORTEX_STEP_TYPE_VIEW_FILE':
      return parseViewFile(step, includeThinking);

    case 'CORTEX_STEP_TYPE_FIND': {
      const find = step.find || {};
      return { role: 'tool', tool_name: 'find', content: find.query || '[File Search]' };
    }

    case 'CORTEX_STEP_TYPE_LIST_DIRECTORY': {
      const ld = step.listDirectory || {};
      const path = ld.directoryPath || ld.path || '';
      return { role: 'tool', tool_name: 'list_dir', content: path || '[List Directory]' };
    }

    case 'CORTEX_STEP_TYPE_SEARCH_WEB':
      return parseSearchWeb(step, includeFull);

    case 'CORTEX_STEP_TYPE_READ_URL_CONTENT': {
      const ru = step.readUrlContent || {};
      return { role: 'tool', tool_name: 'read_url', content: ru.url || '[Read URL]' };
    }

    case 'CORTEX_STEP_TYPE_COMMAND_STATUS':
      return { role: 'tool', tool_name: 'command_status', content: '[Check Command Status]' };

    // System types: skip
    // EPHEMERAL_MESSAGE, CONVERSATION_HISTORY, CHECKPOINT, KNOWLEDGE_ARTIFACTS, ERROR_MESSAGE
    default:
      return null;
  }
}

// ── Diff normalization ──────────────────────────────────

const DIFF_PREFIX = {
  UNIFIED_DIFF_LINE_TYPE_INSERT: '+',
  UNIFIED_DIFF_LINE_TYPE_DELETE: '-',
  UNIFIED_DIFF_LINE_TYPE_CONTEXT: ' ',
};

function normalizeDiff(diff) {
  if (typeof diff === 'string') return diff;
  if (typeof diff === 'object' && diff !== null) {
    const linesData = diff.unifiedDiff?.lines || [];
    if (linesData.length === 0) return JSON.stringify(diff);
    return linesData
      .map((line) => {
        const text = line.text || '';
        const prefix = DIFF_PREFIX[line.type || ''] || ' ';
        return `${prefix}${text}`;
      })
      .join('\n');
  }
  return String(diff);
}

// ── Individual step parsers ─────────────────────────────

function parseUserInput(step, includeFull) {
  const ui = step.userInput || {};
  const content = ui.userResponse || '';
  if (!content) return null;

  const msg = { role: 'user', content };

  if (includeFull) {
    const state = ui.activeUserState || {};
    const activeDoc = state.activeDocument || {};
    if (activeDoc.absoluteUri) {
      msg.active_file = activeDoc.absoluteUri;
      msg.editor_language = activeDoc.editorLanguage || '';
    }
  }

  return msg;
}

function parsePlannerResponse(step, includeThinking, includeFull, modelMapping = {}) {
  const pr = step.plannerResponse || {};
  // Prefer modifiedResponse (post-processed), fall back to response
  const content = pr.modifiedResponse || pr.response || '';
  if (!content) return null;

  const msg = { role: 'assistant', content };

  if (includeThinking) {
    if (pr.thinking) msg.thinking = pr.thinking;
    if (pr.stopReason) msg.stop_reason = pr.stopReason;
  }

  if (includeFull) {
    const metadata = step.metadata || {};
    const rawModel = metadata.generatorModel || '';
    if (rawModel) msg.model = modelMapping[rawModel] || rawModel;
    if (pr.thinkingDuration) msg.thinking_duration = pr.thinkingDuration;
    if (pr.messageId) msg.message_id = pr.messageId;
  }

  return msg;
}

function parseCodeAction(step, includeFull) {
  const ca = step.codeAction || {};
  const description = ca.description || '';

  // File path: prefer actionResult, fall back to actionSpec
  let filePath = '';
  const actionResult = ca.actionResult || {};
  const edit = actionResult.edit || {};
  if (edit.absoluteUri) {
    filePath = edit.absoluteUri;
  } else if (ca.actionSpec?.createFile?.path) {
    filePath = ca.actionSpec.createFile.path;
  }

  let summary = filePath ? `[Code Edit] ${filePath}` : '[Code Edit]';
  if (description) summary += `\n${description}`;

  const msg = { role: 'tool', tool_name: 'code_edit', content: summary };
  if (filePath) msg.file_path = filePath;

  if (includeFull) {
    const diff = edit.diff;
    if (diff) msg.diff = normalizeDiff(diff);
    const artifact = ca.artifactMetadata || {};
    if (artifact.summary) msg.artifact_summary = artifact.summary;
    if (artifact.artifactType) msg.artifact_type = artifact.artifactType;
    if (ca.isArtifactFile) msg.is_artifact = true;
  }

  return msg;
}

function parseRunCommand(step, includeThinking, includeFull) {
  const rc = step.runCommand || {};
  const command = rc.commandLine || rc.command || '';
  if (!command) return null;

  const msg = { role: 'tool', tool_name: 'run_command', content: command };

  if (includeThinking) {
    if (rc.cwd) msg.cwd = rc.cwd;
    if (rc.exitCode !== undefined && rc.exitCode !== null) msg.exit_code = rc.exitCode;
  }

  if (includeFull) {
    const output = rc.combinedOutput?.full;
    if (output) msg.output = output;
  }

  return msg;
}

function parseViewFile(step, includeThinking) {
  const vf = step.viewFile || {};
  const path = vf.absolutePathUri || vf.filePath || vf.path || '';
  if (!path) return null;

  const msg = { role: 'tool', tool_name: 'view_file', content: path };

  if (includeThinking) {
    if (vf.numLines) msg.num_lines = vf.numLines;
    if (vf.numBytes) msg.num_bytes = vf.numBytes;
  }

  return msg;
}

function parseSearchWeb(step, includeFull) {
  const sw = step.searchWeb || {};
  const query = sw.query || '';

  const msg = { role: 'tool', tool_name: 'search_web', content: query || '[Web Search]' };

  if (includeFull) {
    if (sw.summary) msg.search_summary = sw.summary;
    const provider = sw.thirdPartyConfig?.provider;
    if (provider) msg.search_provider = provider;
  }

  return msg;
}

// ════════════════════════════════════════════════════════
// 6. CONVERSATION RECORD BUILDER
// ════════════════════════════════════════════════════════

function buildConversationRecord(cascadeId, title, metadata, messages) {
  const record = {
    cascade_id: cascadeId,
    title,
    step_count: metadata.stepCount || 0,
    created_time: metadata.createdTime || '',
    last_modified_time: metadata.lastModifiedTime || '',
    messages,
  };
  // Extract workspace URIs
  const workspaces = metadata.workspaces
    || metadata.trajectoryMetadata?.workspaces
    || [];
  if (Array.isArray(workspaces) && workspaces.length > 0) {
    const uris = workspaces
      .map((w) => w.workspaceFolderAbsoluteUri || '')
      .filter(Boolean);
    if (uris.length > 0) record.workspaces = uris;
  }
  return record;
}

// ════════════════════════════════════════════════════════
// 7. MAIN EXPORTED FUNCTION
// ════════════════════════════════════════════════════════

/**
 * Collect Antigravity conversations.
 *
 * @param {Object} options
 * @param {boolean} [options.today=true]    - Only today's conversations
 * @param {string}  [options.level='full']  - Field level: default | thinking | full
 * @param {number}  [options.port]          - Manual port override
 * @param {string}  [options.token]         - Manual CSRF token override
 * @returns {{ conversations: Array, error: string|null }}
 */
export async function collectAntigravityConversations(options = {}) {
  const {
    today = true,
    level = LEVEL_FULL,
    port: manualPort,
    token: manualToken,
  } = options;

  try {
    // Step 1: Find endpoints
    let endpoints;

    if (manualPort && manualToken) {
      endpoints = [{ port: manualPort, csrf: manualToken, pid: 0 }];
    } else {
      const servers = discoverLanguageServers();
      if (servers.length === 0) {
        return { conversations: [], error: 'no language server found' };
      }
      endpoints = await findAllEndpoints(servers);
      if (endpoints.length === 0) {
        return { conversations: [], error: 'no reachable language server endpoint' };
      }
    }

    // Step 1b: Get model mapping from the first working endpoint
    let modelMapping = {};
    try {
      const ep = endpoints[0];
      modelMapping = await getModelMapping(ep.port, ep.csrf);
    } catch { /* model mapping is best-effort */ }

    // Step 2: Get all conversation summaries
    const { summaries, cascadeToEndpoint } = await getAllTrajectoriesMerged(endpoints);

    if (Object.keys(summaries).length === 0) {
      return { conversations: [], error: null };
    }

    // Step 3: Filter today's conversations if requested
    let filteredSummaries = summaries;
    if (today) {
      const todayStr = new Date().toISOString().slice(0, 10);
      filteredSummaries = {};
      for (const [cid, info] of Object.entries(summaries)) {
        if ((info.lastModifiedTime || '').startsWith(todayStr)) {
          filteredSummaries[cid] = info;
        }
      }
    }

    if (Object.keys(filteredSummaries).length === 0) {
      return { conversations: [], error: null };
    }

    // Step 4: Sort by lastModifiedTime descending
    const sortedItems = Object.entries(filteredSummaries)
      .sort((a, b) => (b[1].lastModifiedTime || '').localeCompare(a[1].lastModifiedTime || ''));

    const defaultEp = endpoints[0];

    // Step 5: Fetch steps and parse messages (concurrent, max 4 at a time)
    const conversations = [];
    const BATCH_SIZE = 4;

    for (let i = 0; i < sortedItems.length; i += BATCH_SIZE) {
      const batch = sortedItems.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async ([cascadeId, info]) => {
          const ep = cascadeToEndpoint[cascadeId] || { port: defaultEp.port, csrf: defaultEp.csrf };
          const stepCount = info.stepCount || 1000;
          const steps = await getTrajectorySteps(ep.port, ep.csrf, cascadeId, stepCount);
          const messages = parseSteps(steps, level, modelMapping);
          const title = info.summary || 'Untitled';
          return buildConversationRecord(cascadeId, title, info, messages);
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          conversations.push(result.value);
        }
      }
    }

    return { conversations, error: null, model_mapping: modelMapping };
  } catch (e) {
    return { conversations: [], error: e.message || String(e), model_mapping: {} };
  }
}

// ════════════════════════════════════════════════════════
// 8. CLI MODE
// ════════════════════════════════════════════════════════

// Detect if this file is being run directly (not imported)
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('antigravity-collector.mjs')
  || process.argv[1].endsWith('antigravity-collector')
);

if (isDirectRun) {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isAll = args.includes('--all');
  const isFull = args.includes('--full');
  const isThinking = args.includes('--thinking');

  let level = LEVEL_FULL; // default for CLI: full detail
  if (isFull) level = LEVEL_FULL;
  else if (isThinking) level = LEVEL_THINKING;

  const result = await collectAntigravityConversations({
    today: !isAll,
    level,
  });

  if (isTest) {
    if (result.error) {
      process.stderr.write(`ERROR: ${result.error}\n`);
      process.exit(1);
    } else {
      process.stderr.write(`OK: found ${result.conversations.length} conversations\n`);
      process.exit(0);
    }
  } else {
    if (result.error) {
      process.stderr.write(`Error: ${result.error}\n`);
    }
    process.stdout.write(JSON.stringify(result.conversations, null, 2) + '\n');
  }
}
