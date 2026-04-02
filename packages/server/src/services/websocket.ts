import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { verifyToken } from '../middleware/admin-auth.js';

let wss: WebSocketServer | null = null;

// Ping interval to keep connections alive (30 seconds).
// Clients that don't respond within one interval are terminated.
const PING_INTERVAL_MS = 30_000;
let pingTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize WebSocket server attached to the HTTP server.
 */
export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) {
      ws.close(4001, 'Unauthorized');
      return;
    }
    try {
      verifyToken(token);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Mark connection as alive for ping/pong tracking
    (ws as any).isAlive = true;

    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });

    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
  });

  // Ping all connected clients periodically to keep connections alive
  // and detect broken connections (proxies, load balancers, idle timeouts).
  pingTimer = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        ws.terminate();
        return;
      }
      (ws as any).isAlive = false;
      ws.ping();
    });
  }, PING_INTERVAL_MS);

  wss.on('close', () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  });

  return wss;
}

/**
 * Broadcast an event to all connected WebSocket clients.
 */
export function broadcast(event: { type: string; [key: string]: unknown }): void {
  if (!wss) return;

  const data = JSON.stringify({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Get connected client count.
 */
export function getConnectedClients(): number {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) count++;
  });
  return count;
}
