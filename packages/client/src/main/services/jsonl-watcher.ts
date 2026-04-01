import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { apiRequest } from './api-client';
import type { HowinLensConfig } from '../utils/config';

let watcher: FSWatcher | null = null;
const fileOffsets: Map<string, number> = new Map();
let pendingMessages: any[] = [];
let syncInterval: NodeJS.Timeout | null = null;

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

export function startJsonlWatcher(config: HowinLensConfig) {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    console.log('[jsonl-watcher] ~/.claude/projects/ not found, skipping');
    return;
  }

  watcher = chokidar.watch(CLAUDE_PROJECTS_DIR, {
    persistent: true,
    ignoreInitial: true,
    depth: 3,
    // Only watch .jsonl files
    ignored: (filePath: string) => {
      const ext = path.extname(filePath);
      const isDir = !ext;
      return !isDir && ext !== '.jsonl';
    },
  });

  watcher.on('change', (filePath: string) => {
    processJsonlFile(filePath);
  });

  watcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.jsonl')) {
      processJsonlFile(filePath);
    }
  });

  // Sync pending messages every 10 seconds
  syncInterval = setInterval(() => {
    syncMessages(config);
  }, 10000);

  console.log(`[jsonl-watcher] Watching ${CLAUDE_PROJECTS_DIR}`);
}

export function stopJsonlWatcher() {
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

function processJsonlFile(filePath: string) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const offset = fileOffsets.get(filePath) || 0;

    if (content.length <= offset) return;

    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline <= offset) return; // No complete new lines

    const newContent = content.slice(offset, lastNewline + 1);
    fileOffsets.set(filePath, lastNewline + 1);

    const lines = newContent.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const msgType = parsed.type;

        if (msgType === 'user' || msgType === 'assistant') {
          const msg: any = {
            sessionId: parsed.sessionId,
            type: msgType,
            cwd: parsed.cwd,
            gitBranch: parsed.gitBranch,
            timestamp: parsed.timestamp,
          };

          if (msgType === 'user') {
            msg.messageContent = typeof parsed.message?.content === 'string'
              ? parsed.message.content
              : JSON.stringify(parsed.message?.content);
          } else {
            // Assistant message
            const content = parsed.message?.content;
            if (Array.isArray(content)) {
              const textBlocks = content.filter((b: any) => b.type === 'text');
              msg.messageContent = textBlocks.map((b: any) => b.text).join('\n');
            } else {
              msg.messageContent = typeof content === 'string' ? content : '';
            }

            msg.model = parsed.message?.model;
            msg.rawModel = parsed.message?.model; // Store raw model name
            msg.inputTokens = parsed.message?.usage?.input_tokens;
            msg.outputTokens = parsed.message?.usage?.output_tokens;
            msg.cachedTokens = parsed.message?.usage?.cache_read_input_tokens || parsed.message?.usage?.cache_creation_input_tokens;
          }

          pendingMessages.push(msg);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    console.error(`[jsonl-watcher] Error processing ${filePath}:`, err);
  }
}

async function syncMessages(config: HowinLensConfig) {
  if (pendingMessages.length === 0) return;

  const batch = pendingMessages.splice(0, 100); // Send max 100 per batch

  try {
    await apiRequest(config, '/api/v1/client/conversations', {
      method: 'POST',
      body: JSON.stringify({ messages: batch }),
    });
    console.log(`[jsonl-watcher] Synced ${batch.length} messages`);
  } catch (err) {
    // Put them back for retry
    pendingMessages.unshift(...batch);
    console.error('[jsonl-watcher] Sync failed, will retry:', err);
  }
}
