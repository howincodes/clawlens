import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import {
  getUserByToken,
  touchUserLastEvent,
  updateUser,
  getPendingWatcherCommands,
  markWatcherCommandDelivered,
  getLimitsByUser,
  getUserCreditUsage,
  type UserRow,
} from './db.js';

// ---------------------------------------------------------------------------
// Debug logging — enabled by CLAWLENS_DEBUG=1
// ---------------------------------------------------------------------------

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';

function debug(msg: string): void {
  if (DEBUG) console.log(`[watcher-ws] ${msg}`);
}

// ---------------------------------------------------------------------------
// Connection tracking — userId → WebSocket
// ---------------------------------------------------------------------------

const connections = new Map<string, WebSocket>();

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Send a command to a specific connected watcher.
 * Returns true if the watcher was connected and the message was sent.
 */
export function sendToWatcher(
  userId: string,
  command: string,
  payload?: Record<string, unknown>,
): boolean {
  const ws = connections.get(userId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    debug(`sendToWatcher: user ${userId} not connected`);
    return false;
  }

  const msg = JSON.stringify({ type: 'command', command, payload });
  debug(`sendToWatcher: sending to user ${userId} — command=${command}`);
  ws.send(msg);
  return true;
}

/**
 * Check if a specific watcher is currently connected.
 */
export function isWatcherConnected(userId: string): boolean {
  const ws = connections.get(userId);
  return ws !== undefined && ws.readyState === WebSocket.OPEN;
}

/**
 * Get all currently connected watcher user IDs.
 */
export function getConnectedWatcherIds(): string[] {
  const ids: string[] = [];
  for (const [userId, ws] of connections) {
    if (ws.readyState === WebSocket.OPEN) {
      ids.push(userId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function handleHeartbeat(user: UserRow, data: Record<string, unknown>, ws: WebSocket): void {
  debug(`heartbeat from user ${user.id} (${user.name})`);

  // Update last_event_at
  touchUserLastEvent(user.id);

  // Update default_model and email if provided
  const updates: Record<string, string> = {};
  if (data.default_model && typeof data.default_model === 'string' && data.default_model !== user.default_model) {
    updates.default_model = data.default_model;
    debug(`  updating default_model to "${data.default_model}"`);
  }
  if (data.email && typeof data.email === 'string' && (!user.email || user.email === '')) {
    updates.email = data.email;
    debug(`  updating email to "${data.email}"`);
  }
  if (Object.keys(updates).length > 0) {
    try {
      updateUser(user.id, updates);
      // Refresh user fields locally for the response
      if (updates.default_model) user.default_model = updates.default_model;
      if (updates.email) user.email = updates.email;
      debug(`  user updated OK`);
    } catch (e: unknown) {
      debug(`  user update FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Build config response
  const limits = getLimitsByUser(user.id);
  const creditUsage = {
    daily: getUserCreditUsage(user.id, 'daily'),
    hourly: getUserCreditUsage(user.id, 'hourly'),
    monthly: getUserCreditUsage(user.id, 'monthly'),
  };

  // Parse user's notification preferences (default all ON)
  let notifications = { on_stop: true, on_block: true, on_credit_warning: true, on_kill: true, sound: true };
  if (user.notification_config) {
    try { notifications = { ...notifications, ...JSON.parse(user.notification_config) }; } catch {}
  }

  const config = {
    type: 'heartbeat_ack',
    status: user.status,
    poll_interval_ms: user.poll_interval || 30000,
    limits: limits.map((l) => ({
      type: l.type,
      model: l.model,
      value: l.value,
      window: l.window,
    })),
    credit_usage: creditUsage,
    notifications,
    timestamp: new Date().toISOString(),
  };

  debug(`  responding with config: status=${config.status}, limits=${limits.length}, credits=${JSON.stringify(creditUsage)}`);
  ws.send(JSON.stringify(config));
}

function handleHooksRepaired(user: UserRow, data: Record<string, unknown>): void {
  debug(`hooks_repaired from user ${user.id} (${user.name}): ${JSON.stringify(data)}`);
  console.log(`[watcher-ws] User ${user.id} (${user.name}) reported hooks repaired`);
}

function handleModelChanged(user: UserRow, data: Record<string, unknown>): void {
  const newModel = data.model;
  if (!newModel || typeof newModel !== 'string') {
    debug(`model_changed from user ${user.id} — missing or invalid model field`);
    return;
  }
  debug(`model_changed from user ${user.id}: "${user.default_model}" → "${newModel}"`);
  try {
    updateUser(user.id, { default_model: newModel });
    debug(`  model updated OK`);
  } catch (e: unknown) {
    debug(`  model update FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Deliver pending commands
// ---------------------------------------------------------------------------

function deliverPendingCommands(userId: string, ws: WebSocket): void {
  try {
    const commands = getPendingWatcherCommands(userId);
    debug(`delivering ${commands.length} pending command(s) to user ${userId}`);

    for (const cmd of commands) {
      const msg = JSON.stringify({
        type: 'command',
        command: cmd.command,
        payload: cmd.payload ? JSON.parse(cmd.payload) : undefined,
        command_id: cmd.id,
      });
      debug(`  delivering command id=${cmd.id}: ${cmd.command}`);
      ws.send(msg);
      markWatcherCommandDelivered(cmd.id);
      debug(`  marked command id=${cmd.id} as delivered`);
    }
  } catch (e: unknown) {
    debug(`deliverPendingCommands FAILED: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Initialize watcher WebSocket server
// ---------------------------------------------------------------------------

let wss: WebSocketServer | null = null;

export function initWatcherWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws/watcher' });
  debug(`WebSocket server created on path /ws/watcher`);

  wss.on('connection', (ws, req) => {
    // ── Authenticate via ?token= query param ──
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');
    debug(`new connection — token: ${token ? token.slice(0, 8) + '...' : '(missing)'}`);

    if (!token) {
      debug(`REJECTED: no token provided`);
      ws.close(4001, 'Unauthorized: missing token');
      return;
    }

    const user = getUserByToken(token);
    if (!user) {
      debug(`REJECTED: invalid token ${token.slice(0, 8)}...`);
      ws.close(4001, 'Unauthorized: invalid token');
      return;
    }

    debug(`authenticated: user id=${user.id}, name=${user.name}, status=${user.status}`);

    // ── Close any existing connection for this user ──
    const existing = connections.get(user.id);
    if (existing && existing.readyState === WebSocket.OPEN) {
      debug(`closing existing connection for user ${user.id}`);
      existing.close(4000, 'Replaced by new connection');
    }

    // ── Track connection ──
    connections.set(user.id, ws);
    debug(`connection tracked — total connected: ${connections.size}`);

    // ── Send connected confirmation ──
    ws.send(JSON.stringify({
      type: 'connected',
      user_id: user.id,
      status: user.status,
      timestamp: new Date().toISOString(),
    }));

    // ── Deliver pending commands ──
    deliverPendingCommands(user.id, ws);

    // ── Handle incoming messages ──
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const msgType = msg.type as string;
        debug(`message from user ${user.id}: type=${msgType}`);

        switch (msgType) {
          case 'heartbeat':
            handleHeartbeat(user, msg, ws);
            break;
          case 'hooks_repaired':
            handleHooksRepaired(user, msg);
            break;
          case 'model_changed':
            handleModelChanged(user, msg);
            break;
          default:
            debug(`unknown message type: ${msgType}`);
            break;
        }
      } catch (e: unknown) {
        debug(`message parse error: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    // ── Handle disconnect ──
    ws.on('close', (code, reason) => {
      debug(`user ${user.id} disconnected — code=${code}, reason=${reason.toString()}`);
      // Only remove if this is still the tracked connection (not replaced)
      if (connections.get(user.id) === ws) {
        connections.delete(user.id);
        debug(`connection removed — total connected: ${connections.size}`);
      }
    });

    ws.on('error', (err) => {
      debug(`WebSocket error for user ${user.id}: ${err.message}`);
    });
  });

  console.log(`[clawlens] Watcher WebSocket: /ws/watcher`);
  return wss;
}
