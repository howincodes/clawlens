import type { HowinLensConfig } from '../utils/config';
import { startHeartbeat, stopHeartbeat } from './heartbeat';
import { startJsonlWatcher, stopJsonlWatcher } from './jsonl-watcher';
import { startFileWatcher, stopFileWatcher, scanForProjects } from './file-watcher';
import { startWatcherConnection, stopWatcherConnection } from './watcher-connection';
import { hasQueuedEvents } from './offline-queue';

// ---------------------------------------------------------------------------
// Service manager — wraps all background services with health monitoring,
// crash recovery, and graceful shutdown sequencing.
// ---------------------------------------------------------------------------

interface ServiceDef {
  name: string;
  start: (config: HowinLensConfig) => void | Promise<void>;
  stop: () => void;
  critical: boolean;  // If true, restart on crash
}

const services: ServiceDef[] = [
  { name: 'watcher-connection', start: c => startWatcherConnection(c), stop: stopWatcherConnection, critical: true },
  { name: 'heartbeat',          start: c => startHeartbeat(c),         stop: stopHeartbeat,          critical: true },
  { name: 'jsonl-watcher',      start: c => startJsonlWatcher(c),      stop: stopJsonlWatcher,       critical: true },
  { name: 'file-watcher',       start: c => startFileWatcher(c),       stop: stopFileWatcher,        critical: false },
];

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let activeConfig: HowinLensConfig | null = null;
const serviceErrors = new Map<string, number>(); // name → consecutive error count

const HEALTH_CHECK_INTERVAL_MS = 60_000;  // 1 minute
const MAX_RESTART_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start all background services with health monitoring.
 */
export async function startAllServices(config: HowinLensConfig): Promise<void> {
  console.log('[service-manager] Starting all services...');
  console.log('[service-manager]   serverUrl=%s', config.serverUrl);
  console.log('[service-manager]   authToken=%s', config.authToken ? `${config.authToken.substring(0, 8)}...` : 'MISSING');
  activeConfig = config;

  for (const svc of services) {
    console.log('[service-manager] Starting service: %s (critical=%s)', svc.name, svc.critical);
    await startService(svc, config);
  }

  // Scan for projects (non-critical, fire-and-forget)
  scanForProjects(config).catch(err => {
    console.log('[service-manager] scanForProjects failed: %s', err.message);
  });

  // Start health monitor
  healthCheckInterval = setInterval(() => healthCheck(), HEALTH_CHECK_INTERVAL_MS);
  console.log('[service-manager] Health check monitor started (interval=%dms)', HEALTH_CHECK_INTERVAL_MS);

  console.log('[service-manager] ✓ All %d services started', services.length);
}

/**
 * Graceful shutdown — stops services in the correct order:
 * 1. Stop watchers (no new data collection)
 * 2. Flush pending data (offline queue)
 * 3. Disconnect WebSocket
 * 4. Stop heartbeat (last — so server knows we were alive until the end)
 */
export async function stopAllServices(): Promise<void> {
  console.log('[service-manager] Graceful shutdown starting...');

  // Stop health monitor
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }

  // 1. Stop data collection watchers first
  safeStop('file-watcher', stopFileWatcher);
  safeStop('jsonl-watcher', stopJsonlWatcher);

  // 2. Log pending queue state
  if (hasQueuedEvents()) {
    console.log('[service-manager] Offline queue has pending events (will flush on next startup)');
  }

  // 3. Disconnect WebSocket
  safeStop('watcher-connection', stopWatcherConnection);

  // 4. Stop heartbeat last
  safeStop('heartbeat', stopHeartbeat);

  console.log('[service-manager] Graceful shutdown complete');
}

/**
 * Restart a specific service by name.
 */
export async function restartService(name: string): Promise<boolean> {
  if (!activeConfig) return false;

  const svc = services.find(s => s.name === name);
  if (!svc) return false;

  console.log(`[service-manager] Restarting ${name}...`);
  safeStop(name, svc.stop);
  await startService(svc, activeConfig);
  return true;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function startService(svc: ServiceDef, config: HowinLensConfig): Promise<void> {
  try {
    await svc.start(config);
    serviceErrors.set(svc.name, 0);
  } catch (err) {
    console.error(`[service-manager] Failed to start ${svc.name}:`, err);
    const count = (serviceErrors.get(svc.name) || 0) + 1;
    serviceErrors.set(svc.name, count);
  }
}

function safeStop(name: string, stopFn: () => void): void {
  try {
    stopFn();
  } catch (err) {
    console.error(`[service-manager] Error stopping ${name}:`, err);
  }
}

/**
 * Periodic health check — detect crashed services and restart them.
 */
function healthCheck(): void {
  if (!activeConfig) return;

  for (const svc of services) {
    if (!svc.critical) continue;

    const errorCount = serviceErrors.get(svc.name) || 0;
    if (errorCount > 0 && errorCount < MAX_RESTART_ATTEMPTS) {
      console.log(`[service-manager] Health check: ${svc.name} has ${errorCount} errors, restarting...`);
      safeStop(svc.name, svc.stop);
      startService(svc, activeConfig).catch(() => {});
    } else if (errorCount >= MAX_RESTART_ATTEMPTS) {
      // Only log once when we hit the limit
      if (errorCount === MAX_RESTART_ATTEMPTS) {
        console.error(`[service-manager] ${svc.name} exceeded max restart attempts (${MAX_RESTART_ATTEMPTS}), giving up`);
        serviceErrors.set(svc.name, errorCount + 1); // prevent repeat logging
      }
    }
  }
}
