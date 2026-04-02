import WebSocket from 'ws';
import type { HowinLensConfig } from '../utils/config';
import { writeCredentials, type CredentialPayload } from './credentials';
import {
  notifyCredentialRotated,
  notifyUsageAlert,
  notifyNeedsReauth,
  notifyServerCommand,
} from './notifications';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let stopped = false;

const MAX_RECONNECT_DELAY_MS = 60_000;   // 1 minute cap
const BASE_RECONNECT_DELAY_MS = 1_000;   // 1 second initial

// External watchers can subscribe to connection state changes
type ConnectionState = 'connecting' | 'connected' | 'disconnected';
let currentState: ConnectionState = 'disconnected';
let onStateChange: ((state: ConnectionState) => void) | null = null;

function setState(state: ConnectionState): void {
  currentState = state;
  onStateChange?.(state);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the WebSocket connection to the server's watcher endpoint.
 * Automatically reconnects on disconnect with exponential backoff.
 */
export function startWatcherConnection(config: HowinLensConfig): void {
  stopped = false;
  reconnectAttempts = 0;
  connect(config);
}

/**
 * Stop the WebSocket connection. No auto-reconnect.
 */
export function stopWatcherConnection(): void {
  stopped = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.removeAllListeners();
    ws.close(1000, 'Client shutting down');
    ws = null;
  }

  setState('disconnected');
  console.log('[watcher-ws] Stopped');
}

/**
 * Get the current connection state.
 */
export function getWatcherConnectionState(): ConnectionState {
  return currentState;
}

/**
 * Register a callback for connection state changes.
 */
export function onWatcherStateChange(cb: (state: ConnectionState) => void): void {
  onStateChange = cb;
}

/**
 * Check if the WebSocket is currently connected and open.
 */
export function isWatcherConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

// ---------------------------------------------------------------------------
// Connection logic
// ---------------------------------------------------------------------------

function connect(config: HowinLensConfig): void {
  if (stopped) return;

  // Build WebSocket URL from the HTTP server URL
  const wsUrl = config.serverUrl
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://')
    + `/ws/watcher?token=${encodeURIComponent(config.authToken)}`;

  setState('connecting');
  console.log(`[watcher-ws] Connecting to ${config.serverUrl}/ws/watcher`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    reconnectAttempts = 0;
    setState('connected');
    console.log('[watcher-ws] Connected');
  });

  ws.on('message', (raw: WebSocket.Data) => {
    handleMessage(raw);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    console.log(`[watcher-ws] Disconnected — code=${code}, reason=${reason.toString()}`);
    ws = null;
    setState('disconnected');
    scheduleReconnect(config);
  });

  ws.on('error', (err: Error) => {
    // Don't log ECONNREFUSED on every retry — it's expected when the server is down
    if ((err as any).code !== 'ECONNREFUSED') {
      console.error('[watcher-ws] Error:', err.message);
    }
  });

  // Respond to server pings to keep the connection alive
  ws.on('ping', () => {
    ws?.pong();
  });
}

function scheduleReconnect(config: HowinLensConfig): void {
  if (stopped) return;

  reconnectAttempts++;
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1),
    MAX_RECONNECT_DELAY_MS,
  );

  console.log(`[watcher-ws] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(config);
  }, delay);
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(raw: WebSocket.Data): void {
  let msg: any;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    console.error('[watcher-ws] Failed to parse message');
    return;
  }

  const type = msg.type as string;

  switch (type) {
    case 'connected':
      // Server confirmed our connection — log user ID
      console.log(`[watcher-ws] Server confirmed — user_id=${msg.user_id}`);
      break;

    case 'command':
      handleCommand(msg);
      break;

    case 'heartbeat_ack':
      // Config update from server heartbeat response
      handleHeartbeatAck(msg);
      break;

    default:
      console.log(`[watcher-ws] Unhandled message type: ${type}`);
      break;
  }
}

function handleCommand(msg: any): void {
  const command = msg.command as string;
  const payload = msg.payload;

  switch (command) {
    case 'credential_update':
      handleCredentialUpdate(payload);
      break;

    case 'usage_alert':
      notifyUsageAlert(
        payload?.utilization ?? 0,
        payload?.window ?? '5-hour',
      );
      break;

    case 'needs_reauth':
      notifyNeedsReauth(payload?.email ?? 'Unknown account');
      break;

    default:
      notifyServerCommand(command, payload?.message);
      console.log(`[watcher-ws] Unhandled command: ${command}`);
      break;
  }
}

async function handleCredentialUpdate(payload: any): Promise<void> {
  if (!payload?.claudeAiOauth || !payload?.oauthAccount) {
    console.error('[watcher-ws] credential_update: missing claudeAiOauth or oauthAccount');
    return;
  }

  try {
    const credPayload: CredentialPayload = {
      claudeAiOauth: {
        accessToken: payload.claudeAiOauth.accessToken,
        refreshToken: payload.claudeAiOauth.refreshToken,
        expiresAt: payload.claudeAiOauth.expiresAt,
        scopes: payload.claudeAiOauth.scopes || [],
        subscriptionType: payload.claudeAiOauth.subscriptionType || 'team',
        rateLimitTier: payload.claudeAiOauth.rateLimitTier || 'default_raven',
      },
      oauthAccount: {
        accountUuid: payload.oauthAccount.accountUuid || '',
        emailAddress: payload.oauthAccount.emailAddress || '',
        organizationUuid: payload.oauthAccount.organizationUuid || '',
        displayName: payload.oauthAccount.displayName || '',
        organizationName: payload.oauthAccount.organizationName || '',
      },
    };

    await writeCredentials(credPayload);
    notifyCredentialRotated(credPayload.oauthAccount.emailAddress);
    console.log(`[watcher-ws] Credentials updated — email=${credPayload.oauthAccount.emailAddress}`);
  } catch (err) {
    console.error('[watcher-ws] Failed to write credentials:', err);
  }
}

function handleHeartbeatAck(msg: any): void {
  // The server sends config (status, limits, credit_usage, notifications)
  // in response to heartbeat messages. Currently logged for debugging.
  // Phase 3+ will use this to update tray status and trigger notifications.
  if (msg.status) {
    console.log(`[watcher-ws] Heartbeat ack — status=${msg.status}`);
  }
}
