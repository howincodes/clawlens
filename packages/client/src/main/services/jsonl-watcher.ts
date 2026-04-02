import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { apiRequest } from './api-client';
import { enqueue, hasQueuedEvents, flushQueue, loadQueue, type QueuedEvent } from './offline-queue';
import type { HowinLensConfig } from '../utils/config';

// ---------------------------------------------------------------------------
// JSONL Watcher — watches Claude Code session files and sends raw content
// to the server. NO parsing, NO filtering — server handles everything.
// ---------------------------------------------------------------------------

let watcher: FSWatcher | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let debouncedSyncTimer: ReturnType<typeof setTimeout> | null = null;

const BASE_SYNC_INTERVAL_MS = 5_000;
const DEBOUNCE_SYNC_MS = 500;

// Track read offsets per file (byte position)
const fileOffsets = new Map<string, number>();
const OFFSETS_PATH = path.join(os.homedir(), '.howinlens', 'offsets.json');

// Pending raw syncs — one entry per file with accumulated new content
let pendingRawSyncs = new Map<string, RawSyncEntry>();

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

interface RawSyncEntry {
  sessionId: string;
  projectPath: string;
  newContent: string;
  totalOffset: number;
  totalLines: number;
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

export function startJsonlWatcher(config: HowinLensConfig): void {
  console.log('[jsonl-watcher] Starting to watch %s', CLAUDE_PROJECTS_DIR);

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.log('[jsonl-watcher] %s does not exist, skipping', CLAUDE_PROJECTS_DIR);
    return;
  }

  loadQueue();
  loadOffsets();

  const projectDirs = discoverProjectDirs();
  console.log('[jsonl-watcher] %d project directories found', projectDirs.length);

  watcher = chokidar.watch(CLAUDE_PROJECTS_DIR, {
    persistent: true,
    ignoreInitial: false,
    depth: 2,
    ignored: (filePath: string, stats) => {
      if (stats?.isDirectory()) return false;
      return !filePath.endsWith('.jsonl');
    },
  });

  watcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.jsonl')) {
      readNewLines(filePath);
      triggerDebouncedSync(config);
    }
  });

  watcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.jsonl')) {
      readNewLines(filePath);
    }
  });

  // Periodic fallback sync
  syncInterval = setInterval(() => sync(config), BASE_SYNC_INTERVAL_MS);

  console.log('[jsonl-watcher] Watching');
}

export function stopJsonlWatcher(): void {
  if (watcher) { watcher.close(); watcher = null; }
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  if (debouncedSyncTimer) { clearTimeout(debouncedSyncTimer); debouncedSyncTimer = null; }
  saveOffsets();
  console.log('[jsonl-watcher] Stopped');
}

// ---------------------------------------------------------------------------
// Read new lines from a JSONL file — just track raw content, no parsing
// ---------------------------------------------------------------------------

function readNewLines(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const offset = fileOffsets.get(filePath) || 0;

    if (content.length <= offset) return;

    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline <= offset) return;

    const newContent = content.slice(offset, lastNewline + 1);
    fileOffsets.set(filePath, lastNewline + 1);

    const lineCount = newContent.split('\n').filter(l => l.trim()).length;
    const sessionId = path.basename(filePath, '.jsonl');
    const projectDir = path.basename(path.dirname(filePath));

    // Accumulate raw content per file
    const existing = pendingRawSyncs.get(filePath);
    if (existing) {
      existing.newContent += newContent;
      existing.totalOffset = lastNewline + 1;
      existing.totalLines += lineCount;
    } else {
      pendingRawSyncs.set(filePath, {
        sessionId,
        projectPath: projectDir,
        newContent,
        totalOffset: lastNewline + 1,
        totalLines: lineCount,
      });
    }
  } catch (err) {
    console.error(`[jsonl-watcher] Error reading ${filePath}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Sync — send raw content to server (server parses + extracts messages)
// ---------------------------------------------------------------------------

function triggerDebouncedSync(config: HowinLensConfig): void {
  if (debouncedSyncTimer) return;
  debouncedSyncTimer = setTimeout(async () => {
    debouncedSyncTimer = null;
    await sync(config);
  }, DEBOUNCE_SYNC_MS);
}

async function sync(config: HowinLensConfig): Promise<void> {
  // Flush offline queue first
  if (hasQueuedEvents()) {
    await flushOfflineQueue(config);
  }

  // Send pending raw syncs
  if (pendingRawSyncs.size === 0) return;

  const entries = Array.from(pendingRawSyncs.entries());
  pendingRawSyncs.clear();

  for (const [, data] of entries) {
    const payload = {
      sessionId: data.sessionId,
      projectPath: data.projectPath,
      rawContent: data.newContent,
      lineCount: data.totalLines,
      lastOffset: data.totalOffset,
    };

    try {
      const result = await apiRequest(config, '/api/v1/client/session-jsonl', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (result) {
        console.log('[jsonl-watcher] Synced session %s (%d lines, %d messages extracted)',
          data.sessionId.slice(0, 8), data.totalLines, result.extracted || 0);
      } else {
        enqueue({ type: 'session-jsonl', payload, timestamp: Date.now() });
      }
    } catch {
      enqueue({ type: 'session-jsonl', payload, timestamp: Date.now() });
    }
  }

  saveOffsets();
}

async function flushOfflineQueue(config: HowinLensConfig): Promise<number> {
  return flushQueue(async (events: QueuedEvent[]) => {
    let flushed = 0;
    for (const event of events) {
      if (event.type !== 'session-jsonl' && event.type !== 'file-events') {
        flushed++; // skip obsolete event types
        continue;
      }
      const apiPath = event.type === 'session-jsonl'
        ? '/api/v1/client/session-jsonl'
        : '/api/v1/client/file-events';
      try {
        const result = await apiRequest(config, apiPath, {
          method: 'POST',
          body: JSON.stringify(event.payload),
        });
        if (result) { flushed++; } else { break; }
      } catch { break; }
    }
    return flushed;
  });
}

// ---------------------------------------------------------------------------
// Offset persistence
// ---------------------------------------------------------------------------

function loadOffsets(): void {
  try {
    if (fs.existsSync(OFFSETS_PATH)) {
      const saved = JSON.parse(fs.readFileSync(OFFSETS_PATH, 'utf-8')) as Record<string, number>;
      for (const [k, v] of Object.entries(saved)) fileOffsets.set(k, v);
      console.log('[jsonl-watcher] Loaded %d offsets', Object.keys(saved).length);
    }
  } catch {}
}

function saveOffsets(): void {
  try {
    const dir = path.dirname(OFFSETS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, number> = {};
    for (const [k, v] of fileOffsets.entries()) obj[k] = v;
    fs.writeFileSync(OFFSETS_PATH, JSON.stringify(obj));
  } catch {}
}

function discoverProjectDirs(): string[] {
  try {
    return fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => path.join(CLAUDE_PROJECTS_DIR, e.name));
  } catch { return []; }
}
