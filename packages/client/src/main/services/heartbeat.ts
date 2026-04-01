import { apiRequest } from './api-client';
import type { HowinLensConfig } from '../utils/config';

let heartbeatInterval: NodeJS.Timeout | null = null;

export function startHeartbeat(config: HowinLensConfig) {
  // Send heartbeat immediately
  sendHeartbeat(config);

  // Then every 30 seconds
  heartbeatInterval = setInterval(() => {
    sendHeartbeat(config);
  }, 30000);

  console.log('[heartbeat] Started (30s interval)');
}

export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  console.log('[heartbeat] Stopped');
}

async function sendHeartbeat(config: HowinLensConfig) {
  try {
    await apiRequest(config, '/api/v1/client/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        clientVersion: '0.3.0',
        platform: process.platform,
        watchStatus: 'on', // Will be updated by IPC
      }),
    });
  } catch (err) {
    console.error('[heartbeat] Failed:', err);
  }
}
