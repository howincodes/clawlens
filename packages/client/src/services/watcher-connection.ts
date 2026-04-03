import WebSocket from 'ws';
import { getServerUrl } from '../config';
import { writeCredentials, deleteCredentials, type CredentialPayload } from './credentials';
import { notifyCredentialRotated, notifyUsageAlert, notifyNeedsReauth, notifyServerCommand } from './notifications';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let stopped = false;

const MAX_RECONNECT_DELAY_MS = 60_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

export function startWatcherConnection(authToken: string): void {
  stopped = false;
  reconnectAttempts = 0;
  connect(authToken);
}

export function stopWatcherConnection(): void {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.removeAllListeners(); ws.close(1000, 'shutdown'); ws = null; }
  console.log('[ws] Stopped');
}

export function isWatcherConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

function connect(authToken: string): void {
  if (stopped) return;

  const serverUrl = getServerUrl();
  const wsUrl = serverUrl
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://')
    + `/ws/watcher?token=${encodeURIComponent(authToken)}`;

  console.log('[ws] Connecting to %s', serverUrl);
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    reconnectAttempts = 0;
    console.log('[ws] Connected');
  });

  ws.on('message', (raw: WebSocket.Data) => {
    handleMessage(raw);
  });

  ws.on('close', (code: number) => {
    ws = null;
    scheduleReconnect(authToken);
  });

  ws.on('error', (err: Error) => {
    if ((err as any).code !== 'ECONNREFUSED') {
      console.error('[ws] Error: %s', err.message);
    }
  });

  ws.on('ping', () => { ws?.pong(); });
}

function scheduleReconnect(authToken: string): void {
  if (stopped) return;
  reconnectAttempts++;
  const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY_MS);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(authToken); }, delay);
}

function handleMessage(raw: WebSocket.Data): void {
  let msg: any;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  switch (msg.type) {
    case 'connected':
      console.log('[ws] Server confirmed — user_id=%d', msg.user_id);
      break;
    case 'command':
      handleCommand(msg);
      break;
    case 'heartbeat_ack':
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

    case 'credential_revoked':
      console.log('[ws] Credential revoked by admin');
      deleteCredentials();
      notifyServerCommand('credential_revoked', 'Your Claude credential has been revoked.');
      break;

    case 'usage_alert':
      notifyUsageAlert(payload?.utilization ?? 0, payload?.window ?? '5-hour');
      break;

    case 'needs_reauth':
      notifyNeedsReauth(payload?.email ?? 'Unknown');
      break;

    default:
      notifyServerCommand(command, payload?.message);
      break;
  }
}

async function handleCredentialUpdate(payload: any): Promise<void> {
  if (!payload?.claudeAiOauth || !payload?.oauthAccount) {
    console.error('[ws] credential_update: missing payload fields');
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
    console.log('[ws] Credentials updated — %s', credPayload.oauthAccount.emailAddress);
  } catch (err) {
    console.error('[ws] Failed to write credentials:', err);
  }
}
