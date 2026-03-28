import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { verifyToken } from '../middleware/admin-auth.js';

let wss: WebSocketServer | null = null;

/**
 * Initialize WebSocket server attached to the HTTP server.
 */
export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

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
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
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
