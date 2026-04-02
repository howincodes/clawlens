import { apiRequest } from './api-client';
import type { HowinLensConfig } from '../utils/config';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
let currentWatchStatus: 'on' | 'off' = 'off';

const BASE_INTERVAL_MS = 30_000;         // 30s normal
const MAX_BACKOFF_MS = 5 * 60_000;       // 5 minutes max

// Callbacks for other services to react to heartbeat state
type HeartbeatStateCallback = (connected: boolean) => void;
let onStateChange: HeartbeatStateCallback | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startHeartbeat(config: HowinLensConfig): void {
  // Send immediately
  sendHeartbeat(config);

  // Schedule with adaptive interval
  scheduleNext(config);

  console.log('[heartbeat] Started (30s interval)');
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearTimeout(heartbeatInterval);
    heartbeatInterval = null;
  }
  consecutiveFailures = 0;
  console.log('[heartbeat] Stopped');
}

/**
 * Update the watch status reported in heartbeats.
 * Called by IPC handlers / tray when the user toggles watch on/off.
 */
export function setWatchStatus(status: 'on' | 'off'): void {
  currentWatchStatus = status;
}

/**
 * Get the current watch status.
 */
export function getWatchStatus(): 'on' | 'off' {
  return currentWatchStatus;
}

/**
 * Register a callback for heartbeat connectivity changes.
 */
export function onHeartbeatStateChange(cb: HeartbeatStateCallback): void {
  onStateChange = cb;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function scheduleNext(config: HowinLensConfig): void {
  // Exponential backoff on failures: 30s, 60s, 120s, 240s, 300s (capped)
  const delay = consecutiveFailures === 0
    ? BASE_INTERVAL_MS
    : Math.min(BASE_INTERVAL_MS * Math.pow(2, consecutiveFailures), MAX_BACKOFF_MS);

  heartbeatInterval = setTimeout(async () => {
    await sendHeartbeat(config);
    scheduleNext(config);
  }, delay);
}

async function sendHeartbeat(config: HowinLensConfig): Promise<void> {
  try {
    const result = await apiRequest(config, '/api/v1/client/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        clientVersion: '0.3.0',
        platform: process.platform,
        watchStatus: currentWatchStatus,
      }),
    });

    if (result) {
      // Success — reset backoff
      if (consecutiveFailures > 0) {
        console.log(`[heartbeat] Recovered after ${consecutiveFailures} failures`);
      }
      consecutiveFailures = 0;
      onStateChange?.(true);
    } else {
      handleFailure();
    }
  } catch {
    handleFailure();
  }
}

function handleFailure(): void {
  consecutiveFailures++;

  if (consecutiveFailures === 1 || consecutiveFailures % 5 === 0) {
    console.error(`[heartbeat] Failed (${consecutiveFailures} consecutive)`);
  }

  onStateChange?.(false);
}
