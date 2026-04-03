import fs from 'fs';
import path from 'path';
import os from 'os';
import { apiRequest } from '../api-client';
import { CONFIG_DIR } from '../../config';
import { loadOffsets, saveOffsets, readNewBytes, discoverFiles } from './offsets';

// ---------------------------------------------------------------------------
// Codex JSONL Watcher
//
// Polls ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl for new content.
// Sends raw JSONL to server — server parses event_msg types.
//
// Codex JSONL structure:
//   { timestamp, type: 'session_meta'|'event_msg'|'response_item'|'turn_context', payload }
//   event_msg subtypes: task_started, user_message, agent_message, token_count, task_complete
// ---------------------------------------------------------------------------

const CODEX_SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const OFFSETS_PATH = path.join(CONFIG_DIR, 'codex-offsets.json');
const POLL_INTERVAL_MS = 5_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let offsets: Map<string, number> = new Map();
let authToken = '';

export function startCodexWatcher(token: string): void {
  if (!fs.existsSync(CODEX_SESSIONS_DIR)) {
    console.log('[codex] ~/.codex/sessions not found — skipping');
    return;
  }

  authToken = token;
  offsets = loadOffsets(OFFSETS_PATH);

  const hadOffsets = offsets.size > 0;
  const files = discoverFiles(CODEX_SESSIONS_DIR, '.jsonl', 4); // YYYY/MM/DD depth

  if (!hadOffsets) {
    for (const filePath of files) {
      try {
        offsets.set(filePath, fs.statSync(filePath).size);
      } catch {}
    }
    saveOffsets(OFFSETS_PATH, offsets);
    console.log('[codex] First run — skipped history for %d files', files.length);
  } else {
    console.log('[codex] Loaded %d offsets', offsets.size);
  }

  pollTimer = setInterval(pollAndSync, POLL_INTERVAL_MS);
  console.log('[codex] Watching %d files (poll every %ds)', files.length, POLL_INTERVAL_MS / 1000);
}

export function stopCodexWatcher(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  saveOffsets(OFFSETS_PATH, offsets);
  console.log('[codex] Stopped');
}

function pollAndSync(): void {
  // Discover new files (Codex creates new files per session per day)
  const allFiles = discoverFiles(CODEX_SESSIONS_DIR, '.jsonl', 4);
  for (const filePath of allFiles) {
    if (!offsets.has(filePath)) {
      offsets.set(filePath, 0); // New file — track from start
    }
  }

  for (const filePath of offsets.keys()) {
    const offset = offsets.get(filePath) || 0;
    const result = readNewBytes(filePath, offset);
    if (!result) continue;

    offsets.set(filePath, result.newOffset);

    // Extract session ID from filename: rollout-2026-04-03T10-36-37-<uuid>.jsonl
    const fileName = path.basename(filePath, '.jsonl');
    const parts = fileName.split('-');
    // UUID is the last 5 hyphen-separated groups
    const sessionId = parts.slice(-5).join('-');
    const lineCount = result.content.split('\n').filter(l => l.trim()).length;

    apiRequest(authToken, '/api/v1/client/codex-sessions', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        rawContent: result.content,
        lineCount,
        lastOffset: result.newOffset,
      }),
    }).then(res => {
      if (res) {
        console.log('[codex] Synced session %s (%d lines, %d extracted)', sessionId.slice(0, 8), lineCount, res.extracted || 0);
      }
    }).catch(() => {});
  }

  saveOffsets(OFFSETS_PATH, offsets);
}
