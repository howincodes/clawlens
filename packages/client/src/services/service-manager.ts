import fs from 'fs';
import path from 'path';
import os from 'os';
import { getServerUrl, type HowinLensConfig } from '../config';
import { startHeartbeat, stopHeartbeat } from './heartbeat';
import { startWatcherConnection, stopWatcherConnection } from './watcher-connection';
import { startClaudeWatcher, stopClaudeWatcher } from './watchers/claude-watcher';
import { startCodexWatcher, stopCodexWatcher } from './watchers/codex-watcher';
import { startAntigravityWatcher, stopAntigravityWatcher } from './watchers/antigravity-watcher';

// ---------------------------------------------------------------------------
// Service manager — starts/stops all background services
// ---------------------------------------------------------------------------

interface ServiceDef {
  name: string;
  start: () => void | Promise<void>;
  stop: () => void;
}

interface ProviderStatus {
  name: string;
  available: boolean;
  reason?: string;
}

let activeServices: ServiceDef[] = [];
let redetectTimer: ReturnType<typeof setInterval> | null = null;

const REDETECT_INTERVAL_MS = 5 * 60_000; // Re-detect providers every 5 minutes

// ---------------------------------------------------------------------------
// Provider auto-detection
// ---------------------------------------------------------------------------

function detectProviders(): ProviderStatus[] {
  const home = os.homedir();
  return [
    {
      name: 'claude-code',
      available: fs.existsSync(path.join(home, '.claude', 'projects')),
      reason: fs.existsSync(path.join(home, '.claude', 'projects')) ? undefined : '~/.claude/projects not found',
    },
    {
      name: 'codex',
      available: fs.existsSync(path.join(home, '.codex', 'sessions')),
      reason: fs.existsSync(path.join(home, '.codex', 'sessions')) ? undefined : '~/.codex/sessions not found',
    },
    {
      name: 'antigravity',
      available: fs.existsSync(path.join(home, '.gemini', 'antigravity')),
      reason: fs.existsSync(path.join(home, '.gemini', 'antigravity')) ? undefined : '~/.gemini/antigravity not found',
    },
  ];
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

export async function startAllServices(config: HowinLensConfig): Promise<void> {
  const token = config.authToken;
  console.log('[services] Starting... server=%s', getServerUrl());

  // Core services (always start)
  activeServices = [
    { name: 'watcher-connection', start: () => startWatcherConnection(token), stop: stopWatcherConnection },
    { name: 'heartbeat', start: () => startHeartbeat(token), stop: stopHeartbeat },
  ];

  // Detect and start provider watchers
  const providers = detectProviders();
  console.log('[services] Providers:');
  for (const p of providers) {
    if (p.available) {
      console.log('[services]   ● %s', p.name);
    } else {
      console.log('[services]   ○ %s — %s', p.name, p.reason);
    }
  }

  if (providers.find(p => p.name === 'claude-code' && p.available)) {
    activeServices.push({ name: 'claude-watcher', start: () => startClaudeWatcher(token), stop: stopClaudeWatcher });
  }
  if (providers.find(p => p.name === 'codex' && p.available)) {
    activeServices.push({ name: 'codex-watcher', start: () => startCodexWatcher(token), stop: stopCodexWatcher });
  }
  if (providers.find(p => p.name === 'antigravity' && p.available)) {
    activeServices.push({ name: 'antigravity-watcher', start: () => startAntigravityWatcher(token), stop: stopAntigravityWatcher });
  }

  // Start all services
  for (const svc of activeServices) {
    try {
      console.log('[services] Starting %s', svc.name);
      await svc.start();
    } catch (err) {
      console.error('[services] Failed to start %s: %s', svc.name, err);
    }
  }

  // Schedule periodic re-detection (check for newly installed providers)
  redetectTimer = setInterval(() => redetectProviders(token), REDETECT_INTERVAL_MS);

  console.log('[services] ✓ %d services started', activeServices.length);
}

export async function stopAllServices(): Promise<void> {
  console.log('[services] Stopping...');
  if (redetectTimer) { clearInterval(redetectTimer); redetectTimer = null; }
  for (const svc of [...activeServices].reverse()) {
    try { svc.stop(); } catch {}
  }
  console.log('[services] ✓ Stopped');
}

// ---------------------------------------------------------------------------
// Re-detection — start newly available providers
// ---------------------------------------------------------------------------

function redetectProviders(token: string): void {
  const activeNames = new Set(activeServices.map(s => s.name));
  const providers = detectProviders();

  for (const p of providers) {
    if (!p.available) continue;

    const watcherName = p.name === 'claude-code' ? 'claude-watcher'
      : p.name === 'codex' ? 'codex-watcher'
      : p.name === 'antigravity' ? 'antigravity-watcher'
      : null;

    if (!watcherName || activeNames.has(watcherName)) continue;

    console.log('[services] New provider detected: %s — starting watcher', p.name);

    let svc: ServiceDef | null = null;
    if (p.name === 'claude-code') {
      svc = { name: 'claude-watcher', start: () => startClaudeWatcher(token), stop: stopClaudeWatcher };
    } else if (p.name === 'codex') {
      svc = { name: 'codex-watcher', start: () => startCodexWatcher(token), stop: stopCodexWatcher };
    } else if (p.name === 'antigravity') {
      svc = { name: 'antigravity-watcher', start: () => startAntigravityWatcher(token), stop: stopAntigravityWatcher };
    }

    if (svc) {
      try {
        svc.start();
        activeServices.push(svc);
      } catch (err) {
        console.error('[services] Failed to start %s: %s', svc.name, err);
      }
    }
  }
}
