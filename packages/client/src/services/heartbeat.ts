import { apiRequest } from './api-client';
import { readClaudeAuthStatus } from '../config';

let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
let currentWatchStatus: 'on' | 'off' = 'off';

const BASE_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

export function startHeartbeat(authToken: string): void {
  sendHeartbeat(authToken);
  scheduleNext(authToken);
  console.log('[heartbeat] Started (30s interval)');
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) { clearTimeout(heartbeatTimer); heartbeatTimer = null; }
  consecutiveFailures = 0;
  console.log('[heartbeat] Stopped');
}

export function setWatchStatus(status: 'on' | 'off'): void {
  currentWatchStatus = status;
}

export function getWatchStatus(): 'on' | 'off' {
  return currentWatchStatus;
}

function scheduleNext(authToken: string): void {
  const delay = consecutiveFailures === 0
    ? BASE_INTERVAL_MS
    : Math.min(BASE_INTERVAL_MS * Math.pow(2, consecutiveFailures), MAX_BACKOFF_MS);

  heartbeatTimer = setTimeout(async () => {
    await sendHeartbeat(authToken);
    scheduleNext(authToken);
  }, delay);
}

async function sendHeartbeat(authToken: string): Promise<void> {
  try {
    const claudeAuth = readClaudeAuthStatus();

    const result = await apiRequest(authToken, '/api/v1/client/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        clientVersion: '1.0.0',
        platform: process.platform,
        watchStatus: currentWatchStatus,
        claudeAuth,
      }),
    });

    if (result) {
      if (consecutiveFailures > 0) {
        console.log('[heartbeat] Recovered after %d failures', consecutiveFailures);
      }
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }
  } catch {
    consecutiveFailures++;
  }
}
