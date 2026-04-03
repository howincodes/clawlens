import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { apiRequest } from '../api-client';
import { CONFIG_DIR } from '../../config';

// ---------------------------------------------------------------------------
// Antigravity (Gemini Code) Watcher
//
// Two modes:
//   1. Process API — when Antigravity LanguageServer is running,
//      queries its localhost HTTP API for conversations
//   2. Brain files — reads task.md + metadata from
//      ~/.gemini/antigravity/brain/ (always available)
//
// Conversations are stored as encrypted .pb files that can only be
// decoded through the running LanguageServer process.
// ---------------------------------------------------------------------------

const GEMINI_DIR = path.join(os.homedir(), '.gemini', 'antigravity');
const BRAIN_DIR = path.join(GEMINI_DIR, 'brain');
const STATE_PATH = path.join(CONFIG_DIR, 'antigravity-state.json');
const POLL_INTERVAL_MS = 60_000; // 60s — heavier than JSONL, process discovery is expensive

let pollTimer: ReturnType<typeof setInterval> | null = null;
let authToken = '';
let lastSync = 0;
let syncedBrainIds = new Set<string>();

interface LSEndpoint {
  port: number;
  csrf: string;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function startAntigravityWatcher(token: string): void {
  if (!fs.existsSync(GEMINI_DIR)) {
    console.log('[antigravity] ~/.gemini/antigravity not found — skipping');
    return;
  }

  authToken = token;
  loadState();

  pollTimer = setInterval(pollAndSync, POLL_INTERVAL_MS);
  // Also run immediately
  pollAndSync();
  console.log('[antigravity] Watching (poll every %ds)', POLL_INTERVAL_MS / 1000);
}

export function stopAntigravityWatcher(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  saveState();
  console.log('[antigravity] Stopped');
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

async function pollAndSync(): Promise<void> {
  // Mode 1: try process-based collection
  try {
    const endpoint = discoverProcess();
    if (endpoint) {
      await syncFromProcess(endpoint);
    }
  } catch {}

  // Mode 2: sync brain files (always available)
  try {
    await syncBrainFiles();
  } catch {}

  saveState();
}

// ---------------------------------------------------------------------------
// Mode 1: Process-based collection
// ---------------------------------------------------------------------------

function discoverProcess(): LSEndpoint | null {
  try {
    let pids: string[];

    if (process.platform === 'darwin') {
      pids = execSync('pgrep -f language_server_macos 2>/dev/null', { encoding: 'utf-8' }).trim().split('\n');
    } else if (process.platform === 'linux') {
      pids = execSync('pgrep -f language_server_linux 2>/dev/null', { encoding: 'utf-8' }).trim().split('\n');
    } else {
      return null; // Windows not supported for process discovery
    }

    for (const pidStr of pids) {
      const pid = parseInt(pidStr.trim(), 10);
      if (isNaN(pid)) continue;

      // Extract CSRF from process command line
      const csrf = extractCsrf(pid);
      if (!csrf) continue;

      // Find the port
      const port = findPort(pid);
      if (!port) continue;

      return { port, csrf };
    }
  } catch {}
  return null;
}

function extractCsrf(pid: number): string | null {
  try {
    const cmd = execSync(`ps -p ${pid} -o args= 2>/dev/null`, { encoding: 'utf-8' });
    const match = cmd.match(/--csrf[= ](\S+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function findPort(pid: number): number | null {
  try {
    const output = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid} 2>/dev/null`, { encoding: 'utf-8' });
    for (const line of output.split('\n')) {
      const match = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (match) return parseInt(match[1], 10);
    }
  } catch {}
  return null;
}

async function syncFromProcess(endpoint: LSEndpoint): Promise<void> {
  // Get conversation summaries
  const trajectories = await callApi(endpoint, 'getTrajectories', {});
  if (!trajectories || !Array.isArray(trajectories)) return;

  // Filter conversations updated since lastSync
  const sinceMs = lastSync;
  const recent = trajectories.filter((t: any) => {
    const updatedAt = t.updatedAt || t.updated_at || 0;
    return new Date(updatedAt).getTime() > sinceMs;
  });

  if (recent.length === 0) return;

  // Get steps for each recent conversation
  const conversations = [];
  for (const traj of recent.slice(0, 10)) { // Max 10 per cycle
    try {
      const steps = await callApi(endpoint, 'getTrajectorySteps', {
        cascadeId: traj.cascadeId || traj.cascade_id || traj.id,
        stepCount: 100,
      });

      if (steps) {
        conversations.push({
          id: traj.cascadeId || traj.id,
          title: traj.title || traj.displayName || '',
          messages: parseSteps(steps),
          updatedAt: traj.updatedAt || traj.updated_at,
        });
      }
    } catch {}
  }

  if (conversations.length === 0) return;

  // Sync to server
  const result = await apiRequest(authToken, '/api/v1/providers/claude-code/antigravity-sync', {
    method: 'POST',
    body: JSON.stringify({ conversations }),
  });

  if (result) {
    lastSync = Date.now();
    console.log('[antigravity] Synced %d conversations from process', conversations.length);
  }
}

function parseSteps(steps: any): Array<{ type: string; content: string; model?: string }> {
  if (!Array.isArray(steps)) {
    const arr = steps.steps || steps.messages || [];
    return parseSteps(arr);
  }

  const messages: Array<{ type: string; content: string; model?: string }> = [];
  for (const step of steps) {
    const stepType = step.type || step.stepType || '';

    if (stepType === 'user_input' || stepType === 'USER_INPUT') {
      messages.push({
        type: 'user',
        content: step.text || step.userInput || step.content || '',
      });
    } else if (stepType === 'model_output' || stepType === 'MODEL_OUTPUT' || stepType === 'agent_response') {
      messages.push({
        type: 'assistant',
        content: step.text || step.agentResponse || step.content || '',
        model: step.model || step.modelId,
      });
    }
  }
  return messages;
}

function callApi(endpoint: LSEndpoint, method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, params });
    const opts = {
      hostname: 'localhost',
      port: endpoint.port,
      path: '/api',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-CSRF-Token': endpoint.csrf,
      },
      timeout: 10000,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).result); } catch { resolve(null); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Mode 2: Brain files
// ---------------------------------------------------------------------------

async function syncBrainFiles(): Promise<void> {
  if (!fs.existsSync(BRAIN_DIR)) return;

  const brainEntries: Array<{ id: string; summary: string; updatedAt: string }> = [];

  try {
    const dirs = fs.readdirSync(BRAIN_DIR, { withFileTypes: true });
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      if (syncedBrainIds.has(dir.name)) continue;

      const metadataPath = path.join(BRAIN_DIR, dir.name, 'task.md.metadata.json');
      if (!fs.existsSync(metadataPath)) continue;

      try {
        const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        brainEntries.push({
          id: dir.name,
          summary: meta.summary || '',
          updatedAt: meta.updatedAt || '',
        });
        syncedBrainIds.add(dir.name);
      } catch {}
    }
  } catch {}

  if (brainEntries.length === 0) return;

  // Brain files are metadata only — include in heartbeat data or separate endpoint
  console.log('[antigravity] Found %d new brain entries', brainEntries.length);
}

// ---------------------------------------------------------------------------
// State persistence
// ---------------------------------------------------------------------------

function loadState(): void {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      lastSync = state.lastSync || 0;
      syncedBrainIds = new Set(state.syncedBrainIds || []);
    }
  } catch {}
}

function saveState(): void {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      lastSync,
      syncedBrainIds: Array.from(syncedBrainIds),
    }));
  } catch {}
}
