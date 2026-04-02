import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { apiRequest } from './api-client';
import { enqueue, hasQueuedEvents, flushQueue, loadQueue, type QueuedEvent } from './offline-queue';
import type { HowinLensConfig } from '../utils/config';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let watcher: FSWatcher | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;
let retryCount = 0;
const MAX_RETRY_DELAY_MS = 60_000;
const BASE_SYNC_INTERVAL_MS = 10_000;

// Track read offsets per file so we only process new lines
const fileOffsets = new Map<string, number>();

// Batches waiting to be synced (in-memory, overflow goes to offline queue)
let pendingMessages: ParsedMessage[] = [];
let pendingRawSyncs = new Map<string, RawSyncEntry>();

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// ---------------------------------------------------------------------------
// All known JSONL line types from Claude Code
// ---------------------------------------------------------------------------

const ALL_LINE_TYPES = new Set([
  'user',
  'assistant',
  'system',
  'file-history-snapshot',
  'attachment',
  'permission-mode',
  'queue-operation',
  'custom-title',
  'last-prompt',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedMessage {
  sessionId: string;
  type: string;
  messageContent?: string;
  model?: string;
  rawModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
}

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
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.log('[jsonl-watcher] ~/.claude/projects/ not found, skipping');
    return;
  }

  // Load offline queue from disk (events from previous session)
  loadQueue();

  // Watch each project hash directory directly instead of deep glob.
  // This avoids the glob issue on some systems and is more efficient.
  const projectDirs = discoverProjectDirs();

  if (projectDirs.length === 0) {
    console.log('[jsonl-watcher] No project directories found, will re-scan periodically');
  }

  // Watch the projects root for new project directories
  watcher = chokidar.watch(CLAUDE_PROJECTS_DIR, {
    persistent: true,
    ignoreInitial: false,
    depth: 2,                  // projects/<hash>/<session>.jsonl
    ignored: (filePath: string, stats) => {
      // Allow directories to be traversed
      if (stats?.isDirectory()) return false;
      // Only watch .jsonl files
      return !filePath.endsWith('.jsonl');
    },
  });

  watcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.jsonl')) {
      processJsonlFile(filePath);
    }
  });

  watcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.jsonl')) {
      processJsonlFile(filePath);
    }
  });

  // Periodic sync with adaptive interval (backs off on failures)
  scheduleSyncCycle(config);

  console.log(`[jsonl-watcher] Watching ${CLAUDE_PROJECTS_DIR} (${projectDirs.length} project dirs)`);
}

export function stopJsonlWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  console.log('[jsonl-watcher] Stopped');
}

// ---------------------------------------------------------------------------
// Directory discovery
// ---------------------------------------------------------------------------

function discoverProjectDirs(): string[] {
  try {
    const entries = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => path.join(CLAUDE_PROJECTS_DIR, e.name));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// JSONL file processing — handles ALL line types
// ---------------------------------------------------------------------------

function processJsonlFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const offset = fileOffsets.get(filePath) || 0;

    if (content.length <= offset) return;

    // Only process up to the last complete line
    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline <= offset) return;

    const newContent = content.slice(offset, lastNewline + 1);
    fileOffsets.set(filePath, lastNewline + 1);

    const lines = newContent.split('\n').filter(l => l.trim());

    // Extract session and project info from path
    const sessionId = path.basename(filePath, '.jsonl');
    const projectDir = path.basename(path.dirname(filePath));

    // Queue raw content for bulk sync
    queueRawSync(filePath, sessionId, projectDir, newContent, lastNewline + 1, lines.length);

    // Parse individual lines
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const lineType = parsed.type as string;

        if (!lineType || !ALL_LINE_TYPES.has(lineType)) {
          // Unknown type — still include in raw sync, just skip structured parsing
          continue;
        }

        const msg = parseJsonlLine(parsed, sessionId);
        if (msg) {
          pendingMessages.push(msg);
        }
      } catch {
        // Malformed JSON line — skip structured parsing, raw sync still captures it
      }
    }
  } catch (err) {
    console.error(`[jsonl-watcher] Error processing ${filePath}:`, err);
  }
}

/**
 * Parse a JSONL line into a structured message for the conversations endpoint.
 * Handles all Claude Code line types.
 */
function parseJsonlLine(parsed: any, sessionId: string): ParsedMessage | null {
  const lineType = parsed.type as string;

  const base: ParsedMessage = {
    sessionId: parsed.sessionId || sessionId,
    type: lineType,
    cwd: parsed.cwd,
    gitBranch: parsed.gitBranch,
    timestamp: parsed.timestamp,
  };

  switch (lineType) {
    case 'user': {
      const content = parsed.message?.content;
      base.messageContent = typeof content === 'string'
        ? content
        : JSON.stringify(content);
      return base;
    }

    case 'assistant': {
      const content = parsed.message?.content;
      if (Array.isArray(content)) {
        const textBlocks = content.filter((b: any) => b.type === 'text');
        base.messageContent = textBlocks.map((b: any) => b.text).join('\n');
      } else {
        base.messageContent = typeof content === 'string' ? content : '';
      }

      base.model = parsed.message?.model;
      base.rawModel = parsed.message?.model;

      const usage = parsed.message?.usage;
      if (usage) {
        base.inputTokens = usage.input_tokens;
        base.outputTokens = usage.output_tokens;
        base.cachedTokens = usage.cache_read_input_tokens || 0;
        base.cacheCreationTokens = usage.cache_creation_input_tokens || 0;
      }
      return base;
    }

    case 'system': {
      base.messageContent = typeof parsed.message === 'string'
        ? parsed.message
        : JSON.stringify(parsed.message);
      return base;
    }

    case 'file-history-snapshot': {
      // Contains file state at a point in time — store as-is
      base.messageContent = JSON.stringify(parsed.files || parsed.snapshot || parsed);
      return base;
    }

    case 'attachment': {
      base.messageContent = JSON.stringify({
        fileName: parsed.fileName,
        fileType: parsed.fileType,
        filePath: parsed.filePath,
        size: parsed.size,
      });
      return base;
    }

    case 'permission-mode': {
      base.messageContent = parsed.mode || parsed.permissionMode || JSON.stringify(parsed);
      return base;
    }

    case 'queue-operation': {
      base.messageContent = JSON.stringify({
        operation: parsed.operation,
        queueId: parsed.queueId,
        position: parsed.position,
      });
      return base;
    }

    case 'custom-title': {
      base.messageContent = parsed.title || parsed.customTitle || '';
      return base;
    }

    case 'last-prompt': {
      base.messageContent = typeof parsed.prompt === 'string'
        ? parsed.prompt
        : JSON.stringify(parsed.prompt || parsed.message);
      return base;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Raw sync queueing
// ---------------------------------------------------------------------------

function queueRawSync(
  filePath: string,
  sessionId: string,
  projectPath: string,
  newContent: string,
  totalOffset: number,
  lineCount: number,
): void {
  const existing = pendingRawSyncs.get(filePath);
  if (existing) {
    existing.newContent += newContent;
    existing.totalOffset = totalOffset;
    existing.totalLines += lineCount;
  } else {
    pendingRawSyncs.set(filePath, {
      sessionId,
      projectPath,
      newContent,
      totalOffset,
      totalLines: lineCount,
    });
  }
}

// ---------------------------------------------------------------------------
// Sync with retry + offline queue integration
// ---------------------------------------------------------------------------

function scheduleSyncCycle(config: HowinLensConfig): void {
  const doSync = async () => {
    let hadFailure = false;

    // 1. Try to flush offline queue first (events from previous failures)
    if (hasQueuedEvents()) {
      const flushed = await flushOfflineQueue(config);
      if (flushed === 0 && hasQueuedEvents()) {
        hadFailure = true;
      }
    }

    // 2. Sync current in-memory batches
    const msgResult = await syncMessages(config);
    const rawResult = await syncRawFiles(config);

    if (!msgResult || !rawResult) {
      hadFailure = true;
    }

    // Adaptive interval: back off on failures, reset on success
    if (hadFailure) {
      retryCount = Math.min(retryCount + 1, 6); // cap at ~64s
    } else {
      retryCount = 0;
    }
  };

  syncInterval = setInterval(doSync, BASE_SYNC_INTERVAL_MS);
}

/**
 * Sync parsed messages. Returns true on success, false on failure.
 */
async function syncMessages(config: HowinLensConfig): Promise<boolean> {
  if (pendingMessages.length === 0) return true;

  const batch = pendingMessages.splice(0, 100);

  try {
    const result = await apiRequest(config, '/api/v1/client/conversations', {
      method: 'POST',
      body: JSON.stringify({ messages: batch }),
    });

    if (result) {
      console.log(`[jsonl-watcher] Synced ${batch.length} messages`);
      return true;
    }

    // API returned null (HTTP error) — queue for retry
    enqueueMessages(batch);
    return false;
  } catch {
    // Network error — queue for offline retry
    enqueueMessages(batch);
    return false;
  }
}

/**
 * Sync raw JSONL files. Returns true on success, false on failure.
 */
async function syncRawFiles(config: HowinLensConfig): Promise<boolean> {
  if (pendingRawSyncs.size === 0) return true;

  const entries = Array.from(pendingRawSyncs.entries());
  pendingRawSyncs.clear();

  let allOk = true;

  for (const [filePath, data] of entries) {
    try {
      const result = await apiRequest(config, '/api/v1/client/session-jsonl', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: data.sessionId,
          projectPath: data.projectPath,
          rawContent: data.newContent,
          lineCount: data.totalLines,
          lastOffset: data.totalOffset,
        }),
      });

      if (result) {
        console.log(`[jsonl-watcher] Synced raw JSONL for session ${data.sessionId} (${data.totalLines} lines)`);
      } else {
        // Queue for offline retry
        enqueue({
          type: 'session-jsonl',
          payload: {
            sessionId: data.sessionId,
            projectPath: data.projectPath,
            rawContent: data.newContent,
            lineCount: data.totalLines,
            lastOffset: data.totalOffset,
          },
          timestamp: Date.now(),
        });
        allOk = false;
      }
    } catch {
      enqueue({
        type: 'session-jsonl',
        payload: {
          sessionId: data.sessionId,
          projectPath: data.projectPath,
          rawContent: data.newContent,
          lineCount: data.totalLines,
          lastOffset: data.totalOffset,
        },
        timestamp: Date.now(),
      });
      allOk = false;
    }
  }

  return allOk;
}

function enqueueMessages(batch: ParsedMessage[]): void {
  enqueue({
    type: 'conversations',
    payload: { messages: batch },
    timestamp: Date.now(),
  });
}

/**
 * Flush offline queue events to the server.
 */
async function flushOfflineQueue(config: HowinLensConfig): Promise<number> {
  return flushQueue(async (events: QueuedEvent[]) => {
    let flushed = 0;

    for (const event of events) {
      try {
        let apiPath: string;
        let body: string;

        switch (event.type) {
          case 'conversations':
            apiPath = '/api/v1/client/conversations';
            body = JSON.stringify(event.payload);
            break;
          case 'session-jsonl':
            apiPath = '/api/v1/client/session-jsonl';
            body = JSON.stringify(event.payload);
            break;
          case 'file-events':
            apiPath = '/api/v1/client/file-events';
            body = JSON.stringify(event.payload);
            break;
          default:
            // Unknown event type — skip
            flushed++;
            continue;
        }

        const result = await apiRequest(config, apiPath, {
          method: 'POST',
          body,
        });

        if (result) {
          flushed++;
        } else {
          // Server returned error — stop flushing to avoid repeated failures
          break;
        }
      } catch {
        // Network error — stop flushing
        break;
      }
    }

    return flushed;
  });
}
