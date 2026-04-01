import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { apiRequest } from './api-client';
import type { HowinLensConfig } from '../utils/config';

let watcher: FSWatcher | null = null;
let pendingEvents: Array<{ filePath: string; eventType: string; timestamp: string }> = [];
let syncInterval: NodeJS.Timeout | null = null;
let watchedDirs: string[] = [];

const IGNORED_PATTERNS = [
  '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
  '**/.next/**', '**/__pycache__/**', '**/*.log', '**/coverage/**',
];

export async function startFileWatcher(config: HowinLensConfig) {
  // Get project directories from server
  try {
    const dirs = await apiRequest(config, '/api/v1/client/project-directories');
    if (Array.isArray(dirs)) {
      watchedDirs = dirs.map((d: any) => d.localPath).filter((p: string) => fs.existsSync(p));
    }
  } catch {}

  if (watchedDirs.length === 0) {
    console.log('[file-watcher] No project directories to watch');
    return;
  }

  watcher = chokidar.watch(watchedDirs, {
    persistent: true,
    ignoreInitial: true,
    ignored: IGNORED_PATTERNS,
    depth: 5,
  });

  watcher.on('add', (filePath: string) => recordEvent(filePath, 'create'));
  watcher.on('change', (filePath: string) => recordEvent(filePath, 'modify'));
  watcher.on('unlink', (filePath: string) => recordEvent(filePath, 'delete'));

  // Sync every 30 seconds
  syncInterval = setInterval(() => syncEvents(config), 30000);

  console.log(`[file-watcher] Watching ${watchedDirs.length} directories`);
}

export function stopFileWatcher() {
  if (watcher) { watcher.close(); watcher = null; }
  if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
}

function recordEvent(filePath: string, eventType: string) {
  pendingEvents.push({
    filePath,
    eventType,
    timestamp: new Date().toISOString(),
  });
}

async function syncEvents(config: HowinLensConfig) {
  if (pendingEvents.length === 0) return;
  const batch = pendingEvents.splice(0, 200);
  try {
    await apiRequest(config, '/api/v1/client/file-events', {
      method: 'POST',
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    pendingEvents.unshift(...batch);
  }
}

/**
 * Scan common dev directories for git repos and auto-discover projects.
 */
export async function scanForProjects(config: HowinLensConfig) {
  const home = os.homedir();
  const searchDirs = [
    path.join(home, 'Documents'),
    path.join(home, 'Projects'),
    path.join(home, 'Code'),
    path.join(home, 'dev'),
    path.join(home, 'src'),
  ].filter(d => fs.existsSync(d));

  for (const dir of searchDirs) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const gitConfig = path.join(dir, entry.name, '.git', 'config');
        if (fs.existsSync(gitConfig)) {
          try {
            const content = fs.readFileSync(gitConfig, 'utf-8');
            const remoteMatch = content.match(/url\s*=\s*(.+)/);
            if (remoteMatch) {
              const remoteUrl = remoteMatch[1].trim();
              // Report to server for matching
              await apiRequest(config, '/api/v1/client/project-directories', {
                method: 'POST',
                body: JSON.stringify({
                  localPath: path.join(dir, entry.name),
                  discoveredVia: 'scan',
                  remoteUrl,
                }),
              }).catch(() => {});
            }
          } catch {}
        }
      }
    } catch {}
  }
}
