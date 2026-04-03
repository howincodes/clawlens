import fs from 'fs';
import path from 'path';
import os from 'os';
import { apiRequest } from '../api-client';
import { CONFIG_DIR } from '../../config';
import { loadOffsets, saveOffsets, readNewBytes, discoverFiles } from './offsets';

// ---------------------------------------------------------------------------
// Claude Code JSONL Watcher
//
// Polls ~/.claude/projects/<hash>/<session>.jsonl for new content.
// Sends raw JSONL to server — server does all parsing and extraction.
// ---------------------------------------------------------------------------

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const OFFSETS_PATH = path.join(CONFIG_DIR, 'claude-offsets.json');
const POLL_INTERVAL_MS = 5_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let offsets: Map<string, number> = new Map();
let authToken = '';

export function startClaudeWatcher(token: string): void {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.log('[claude] ~/.claude/projects not found — skipping');
    return;
  }

  authToken = token;
  offsets = loadOffsets(OFFSETS_PATH);

  // First run: skip all history (set offsets to current file sizes)
  const hadOffsets = offsets.size > 0;
  const files = discoverFiles(CLAUDE_PROJECTS_DIR, '.jsonl', 2);

  if (!hadOffsets) {
    for (const filePath of files) {
      try {
        offsets.set(filePath, fs.statSync(filePath).size);
      } catch {}
    }
    saveOffsets(OFFSETS_PATH, offsets);
    console.log('[claude] First run — skipped history for %d files', files.length);
  } else {
    console.log('[claude] Loaded %d offsets', offsets.size);
  }

  // Start polling
  pollTimer = setInterval(pollAndSync, POLL_INTERVAL_MS);
  console.log('[claude] Watching %d files (poll every %ds)', files.length, POLL_INTERVAL_MS / 1000);
}

export function stopClaudeWatcher(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  saveOffsets(OFFSETS_PATH, offsets);
  console.log('[claude] Stopped');
}

function pollAndSync(): void {
  // Discover new files that appeared since startup
  const allFiles = discoverFiles(CLAUDE_PROJECTS_DIR, '.jsonl', 2);
  for (const filePath of allFiles) {
    if (!offsets.has(filePath)) {
      // New file — start tracking from current position (only new content)
      offsets.set(filePath, 0);
    }
  }

  // Read new content from each tracked file
  for (const filePath of offsets.keys()) {
    const offset = offsets.get(filePath) || 0;
    const result = readNewBytes(filePath, offset);
    if (!result) continue;

    offsets.set(filePath, result.newOffset);

    const sessionId = path.basename(filePath, '.jsonl');
    const projectDir = path.basename(path.dirname(filePath));
    const lineCount = result.content.split('\n').filter(l => l.trim()).length;

    // Send raw content to server — server parses and extracts messages
    apiRequest(authToken, '/api/v1/client/session-jsonl', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        projectPath: projectDir,
        rawContent: result.content,
        lineCount,
        lastOffset: result.newOffset,
      }),
    }).then(res => {
      if (res) {
        console.log('[claude] Synced session %s (%d lines, %d extracted)', sessionId.slice(0, 8), lineCount, res.extracted || 0);
      }
    }).catch(() => {});
  }

  saveOffsets(OFFSETS_PATH, offsets);
}
