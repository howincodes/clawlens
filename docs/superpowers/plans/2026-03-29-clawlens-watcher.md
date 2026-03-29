# ClawLens Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent background watcher process on developer machines that enforces hook integrity, syncs config from server via WebSocket, delivers desktop notifications, and provides admin remote control. Also clean up server: remove tamper alerts, auto-start dead man's switch.

**Architecture:** Single-file Node.js watcher (`clawlens-watcher.mjs`) runs as a user login agent. Connects to server via WebSocket (primary) with HTTP poll fallback. Server gets new `/ws/watcher` channel, watcher sync/logs/command endpoints, and dashboard UI additions on User Detail page.

**Tech Stack:** Node.js 18+ (built-ins only), Express, TypeScript (server), React (dashboard), SQLite, WebSocket (ws library on server, raw http upgrade on client for Node 18 compat)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/server/src/services/db.ts` | Modify | Add watcher_commands + watcher_logs tables, DB helpers |
| `packages/server/src/services/watcher-ws.ts` | Create | Watcher WebSocket channel (/ws/watcher) |
| `packages/server/src/routes/watcher-api.ts` | Create | POST /sync, POST /logs endpoints |
| `packages/server/src/routes/admin-api.ts` | Modify | Add watcher admin endpoints (command, logs, status) |
| `packages/server/src/server.ts` | Modify | Mount watcher routes + WS, auto-start deadman |
| `packages/server/src/routes/hook-api.ts` | Modify | Remove tamper alert imports fully |
| `packages/server/tests/watcher-api.test.ts` | Create | Tests for watcher endpoints |
| `client/clawlens-watcher.mjs` | Create | The watcher process |
| `client/clawlens.mjs` | Modify | Add backup watcher spawn on SessionStart |
| `scripts/install.sh` | Modify | Add watcher install + login agent setup |
| `scripts/install.ps1` | Modify | Same for Windows |
| `scripts/uninstall.sh` | Rewrite | Full removal: watcher, hooks, cache, login agent |
| `scripts/uninstall.ps1` | Create | Windows full removal |
| `packages/dashboard/src/pages/UserDetail.tsx` | Modify | Add Watcher section |
| `packages/dashboard/src/pages/Overview.tsx` | Modify | Add watcher connection dot |
| `packages/dashboard/src/lib/api.ts` | Modify | Add watcher API functions |

---

### Task 1: Server — Database Schema for Watcher

**Files:**
- Modify: `packages/server/src/services/db.ts`
- Test: `packages/server/tests/db.test.ts`

- [ ] **Step 1: Add watcher tables to initDb schema**

In `packages/server/src/services/db.ts`, find the `initDb` function and add after the existing `CREATE TABLE` statements:

```sql
CREATE TABLE IF NOT EXISTS watcher_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  command TEXT NOT NULL,
  payload TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_watcher_commands_user ON watcher_commands(user_id, status);

CREATE TABLE IF NOT EXISTS watcher_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  hook_log TEXT,
  watcher_log TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Add DB helper functions**

Add these exports to `db.ts`:

```typescript
// ---------------------------------------------------------------------------
// Watcher Commands
// ---------------------------------------------------------------------------

export interface WatcherCommandRow {
  id: number;
  user_id: string;
  command: string;
  payload: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export function createWatcherCommand(params: {
  user_id: string;
  command: string;
  payload?: string;
}): WatcherCommandRow {
  const database = getDb();
  return database.prepare(
    `INSERT INTO watcher_commands (user_id, command, payload)
     VALUES (?, ?, ?)
     RETURNING *`,
  ).get(params.user_id, params.command, params.payload ?? null) as WatcherCommandRow;
}

export function getPendingWatcherCommands(userId: string): WatcherCommandRow[] {
  const database = getDb();
  return database.prepare(
    `SELECT * FROM watcher_commands WHERE user_id = ? AND status = 'pending' ORDER BY created_at ASC`,
  ).all(userId) as WatcherCommandRow[];
}

export function markWatcherCommandDelivered(commandId: number): void {
  const database = getDb();
  database.prepare(
    `UPDATE watcher_commands SET status = 'delivered', completed_at = datetime('now') WHERE id = ?`,
  ).run(commandId);
}

// ---------------------------------------------------------------------------
// Watcher Logs
// ---------------------------------------------------------------------------

export interface WatcherLogRow {
  id: number;
  user_id: string;
  hook_log: string | null;
  watcher_log: string | null;
  uploaded_at: string;
}

export function saveWatcherLogs(params: {
  user_id: string;
  hook_log?: string;
  watcher_log?: string;
}): WatcherLogRow {
  const database = getDb();
  return database.prepare(
    `INSERT INTO watcher_logs (user_id, hook_log, watcher_log)
     VALUES (?, ?, ?)
     RETURNING *`,
  ).get(params.user_id, params.hook_log ?? null, params.watcher_log ?? null) as WatcherLogRow;
}

export function getLatestWatcherLogs(userId: string): WatcherLogRow | undefined {
  const database = getDb();
  return database.prepare(
    `SELECT * FROM watcher_logs WHERE user_id = ? ORDER BY uploaded_at DESC LIMIT 1`,
  ).get(userId) as WatcherLogRow | undefined;
}
```

- [ ] **Step 3: Write tests for watcher DB helpers**

Add to `packages/server/tests/db.test.ts`:

```typescript
describe('watcher commands', () => {
  it('should create and retrieve pending commands', () => {
    const user = createUser({ name: 'watcher-test', team_id: team.id });
    const cmd = createWatcherCommand({ user_id: user.id, command: 'upload_logs' });
    expect(cmd.command).toBe('upload_logs');
    expect(cmd.status).toBe('pending');

    const pending = getPendingWatcherCommands(user.id);
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(cmd.id);
  });

  it('should mark commands as delivered', () => {
    const user = createUser({ name: 'watcher-test2', team_id: team.id });
    const cmd = createWatcherCommand({ user_id: user.id, command: 'notify', payload: '{"message":"hi"}' });
    markWatcherCommandDelivered(cmd.id);

    const pending = getPendingWatcherCommands(user.id);
    expect(pending.length).toBe(0);
  });
});

describe('watcher logs', () => {
  it('should save and retrieve logs', () => {
    const user = createUser({ name: 'watcher-log-test', team_id: team.id });
    saveWatcherLogs({ user_id: user.id, hook_log: 'hook data', watcher_log: 'watcher data' });

    const latest = getLatestWatcherLogs(user.id);
    expect(latest).toBeDefined();
    expect(latest!.hook_log).toBe('hook data');
    expect(latest!.watcher_log).toBe('watcher data');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass including new watcher DB tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/db.ts packages/server/tests/db.test.ts
git commit -m "feat(server): watcher DB schema — watcher_commands + watcher_logs tables"
```

---

### Task 2: Server — Watcher WebSocket Channel

**Files:**
- Create: `packages/server/src/services/watcher-ws.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Create watcher-ws.ts**

Create `packages/server/src/services/watcher-ws.ts`:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import {
  getUserByToken,
  touchUserLastEvent,
  updateUser,
  getPendingWatcherCommands,
  markWatcherCommandDelivered,
  getLimitsByUser,
  getUserCreditUsage,
} from './db.js';

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';
function debug(msg: string): void {
  if (DEBUG) console.log(`[watcher-ws] ${msg}`);
}

// Map of user_id → WebSocket for sending commands to specific watchers
const watcherConnections = new Map<string, WebSocket>();

/**
 * Initialize watcher WebSocket server on /ws/watcher path.
 */
export function initWatcherWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/watcher' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      debug('connection rejected: no token');
      ws.close(4001, 'Unauthorized');
      return;
    }

    const user = getUserByToken(token);
    if (!user) {
      debug(`connection rejected: invalid token ${token.slice(0, 8)}...`);
      ws.close(4001, 'Unauthorized');
      return;
    }

    debug(`watcher connected: user=${user.name} (${user.id})`);
    watcherConnections.set(user.id, ws);
    touchUserLastEvent(user.id);

    // Send initial config
    sendConfig(ws, user.id);

    // Deliver any pending commands
    deliverPendingCommands(ws, user.id);

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        debug(`received from ${user.name}: type=${msg.type}`);
        handleWatcherMessage(ws, user.id, msg);
      } catch (e: any) {
        debug(`message parse error from ${user.name}: ${e.message}`);
      }
    });

    ws.on('close', () => {
      debug(`watcher disconnected: user=${user.name}`);
      watcherConnections.delete(user.id);
    });

    ws.on('error', (err) => {
      debug(`watcher error for ${user.name}: ${err.message}`);
      watcherConnections.delete(user.id);
    });
  });

  return wss;
}

function handleWatcherMessage(ws: WebSocket, userId: string, msg: any): void {
  switch (msg.type) {
    case 'heartbeat':
      touchUserLastEvent(userId);
      // Update user fields from heartbeat
      const updates: Record<string, string> = {};
      if (msg.model) updates.default_model = msg.model;
      if (msg.subscription_email) updates.email = msg.subscription_email;
      if (Object.keys(updates).length > 0) {
        try { updateUser(userId, updates); } catch {}
      }
      // Respond with fresh config
      sendConfig(ws, userId);
      break;

    case 'hooks_repaired':
      debug(`hooks repaired by watcher for ${userId}: ${JSON.stringify(msg.missing_events)}`);
      break;

    case 'model_changed':
      debug(`model changed for ${userId}: ${msg.old_model} → ${msg.new_model}`);
      if (msg.new_model) {
        try { updateUser(userId, { default_model: msg.new_model }); } catch {}
      }
      break;

    default:
      debug(`unknown message type: ${msg.type}`);
  }
}

function sendConfig(ws: WebSocket, userId: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const limits = getLimitsByUser(userId);
  const usage = getUserCreditUsage(userId, 'daily');
  const totalLimit = limits.find(l => l.type === 'total_credits' && l.window === 'daily');
  const limitValue = totalLimit?.value ?? 0;
  const percent = limitValue > 0 ? Math.round((usage / limitValue) * 100) : 0;

  ws.send(JSON.stringify({
    type: 'config',
    status: 'active',
    poll_interval_ms: 300000,
    limits,
    credit_usage: { used: usage, limit: limitValue, percent },
  }));
}

function deliverPendingCommands(ws: WebSocket, userId: string): void {
  const commands = getPendingWatcherCommands(userId);
  for (const cmd of commands) {
    if (ws.readyState !== WebSocket.OPEN) break;
    const payload = cmd.payload ? JSON.parse(cmd.payload) : {};
    ws.send(JSON.stringify({
      type: 'command',
      command: cmd.command,
      ...payload,
    }));
    markWatcherCommandDelivered(cmd.id);
    debug(`delivered command ${cmd.command} (id=${cmd.id}) to ${userId}`);
  }
}

/**
 * Send a command to a connected watcher. Returns true if delivered.
 */
export function sendToWatcher(userId: string, command: string, payload?: Record<string, unknown>): boolean {
  const ws = watcherConnections.get(userId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  ws.send(JSON.stringify({ type: 'command', command, ...payload }));
  debug(`sent command ${command} to ${userId}`);
  return true;
}

/**
 * Check if a watcher is connected for a given user.
 */
export function isWatcherConnected(userId: string): boolean {
  const ws = watcherConnections.get(userId);
  return !!ws && ws.readyState === WebSocket.OPEN;
}

/**
 * Get all connected watcher user IDs.
 */
export function getConnectedWatcherIds(): string[] {
  const ids: string[] = [];
  for (const [userId, ws] of watcherConnections) {
    if (ws.readyState === WebSocket.OPEN) ids.push(userId);
  }
  return ids;
}
```

- [ ] **Step 2: Mount watcher WebSocket in server.ts**

In `packages/server/src/server.ts`, add import and init call:

```typescript
import { initWatcherWebSocket } from './services/watcher-ws.js';
```

After `initWebSocket(server);` add:

```typescript
initWatcherWebSocket(server);
```

Also add dead man's switch auto-start after the server.listen callback:

```typescript
import { startDeadmanSwitch } from './services/deadman.js';
```

Inside the `server.listen` callback, add:

```typescript
const stopDeadman = startDeadmanSwitch();
```

And in the shutdown function:

```typescript
stopDeadman();
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/services/watcher-ws.ts packages/server/src/server.ts
git commit -m "feat(server): watcher WebSocket channel + auto-start dead man's switch"
```

---

### Task 3: Server — Watcher HTTP Endpoints

**Files:**
- Create: `packages/server/src/routes/watcher-api.ts`
- Modify: `packages/server/src/server.ts`
- Create: `packages/server/tests/watcher-api.test.ts`

- [ ] **Step 1: Create watcher-api.ts**

Create `packages/server/src/routes/watcher-api.ts`:

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  touchUserLastEvent,
  updateUser,
  getLimitsByUser,
  getUserCreditUsage,
  getPendingWatcherCommands,
  markWatcherCommandDelivered,
  saveWatcherLogs,
} from '../services/db.js';

const DEBUG = process.env.CLAWLENS_DEBUG === '1' || process.env.CLAWLENS_DEBUG === 'true';
function debug(msg: string): void {
  if (DEBUG) console.log(`[watcher-api] ${msg}`);
}

export const watcherRouter = Router();

// ---------------------------------------------------------------------------
// POST /sync — Poll fallback for watcher
// ---------------------------------------------------------------------------

watcherRouter.post('/sync', (req: Request, res: Response) => {
  debug(`──── /sync ────`);
  try {
    const user = req.user!;
    const body = req.body;
    debug(`user: ${user.name} (${user.id})`);
    debug(`body: model=${body.model}, hooks_intact=${body.hooks_intact}, uptime=${body.uptime_seconds}`);

    // Update user from heartbeat
    touchUserLastEvent(user.id);
    const updates: Record<string, string> = {};
    if (body.model) updates.default_model = body.model;
    if (body.subscription_email && (!user.email || user.email === '')) {
      updates.email = body.subscription_email;
    }
    if (Object.keys(updates).length > 0) {
      try { updateUser(user.id, updates); } catch {}
    }

    // Build config response
    const limits = getLimitsByUser(user.id);
    const usage = getUserCreditUsage(user.id, 'daily');
    const totalLimit = limits.find(l => l.type === 'total_credits' && l.window === 'daily');
    const limitValue = totalLimit?.value ?? 0;
    const percent = limitValue > 0 ? Math.round((usage / limitValue) * 100) : 0;

    // Get pending commands
    const commands = getPendingWatcherCommands(user.id);
    const commandList = commands.map(cmd => {
      markWatcherCommandDelivered(cmd.id);
      const payload = cmd.payload ? JSON.parse(cmd.payload) : {};
      return { id: cmd.id, type: cmd.command, ...payload };
    });

    const response = {
      status: user.status,
      poll_interval_ms: 300000,
      limits,
      credit_usage: { used: usage, limit: limitValue, percent },
      commands: commandList,
    };

    debug(`responding with ${commandList.length} commands`);
    res.json(response);
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[watcher-api] sync error:', err);
    res.json({ status: 'active', poll_interval_ms: 300000, limits: [], credit_usage: {}, commands: [] });
  }
});

// ---------------------------------------------------------------------------
// POST /logs — Log upload from watcher
// ---------------------------------------------------------------------------

watcherRouter.post('/logs', (req: Request, res: Response) => {
  debug(`──── /logs ────`);
  try {
    const user = req.user!;
    const { hook_log, watcher_log } = req.body;
    debug(`user: ${user.name}, hook_log=${(hook_log || '').length} chars, watcher_log=${(watcher_log || '').length} chars`);

    saveWatcherLogs({
      user_id: user.id,
      hook_log: typeof hook_log === 'string' ? hook_log.slice(0, 512000) : undefined,
      watcher_log: typeof watcher_log === 'string' ? watcher_log.slice(0, 512000) : undefined,
    });

    debug(`logs saved`);
    res.json({ ok: true });
  } catch (err: any) {
    debug(`ERROR: ${err.stack || err.message}`);
    console.error('[watcher-api] logs error:', err);
    res.status(500).json({ error: 'Failed to save logs' });
  }
});
```

- [ ] **Step 2: Mount watcher routes in server.ts**

In `packages/server/src/server.ts`:

```typescript
import { watcherRouter } from './routes/watcher-api.js';
```

After the hook API mount (`app.use('/api/v1/hook', hookAuth, hookRouter);`), add:

```typescript
app.use('/api/v1/watcher', hookAuth, watcherRouter);
```

- [ ] **Step 3: Write watcher API tests**

Create `packages/server/tests/watcher-api.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/server.js';
import {
  initDb,
  closeDb,
  createUser,
  createWatcherCommand,
  getLatestWatcherLogs,
  getPendingWatcherCommands,
} from '../src/services/db.js';

let activeUser: any;
const ACTIVE_TOKEN = 'clwt_watcher_test_active';

beforeAll(() => {
  initDb(':memory:');
  // Create team + user
  const { getDb } = require('../src/services/db.js');
  const db = getDb();
  db.prepare(`INSERT INTO teams (id, name, slug) VALUES ('t1', 'Test Team', 'test-team')`).run();
  activeUser = createUser({ name: 'watcher-user', team_id: 't1' });
  db.prepare(`UPDATE users SET auth_token = ? WHERE id = ?`).run(ACTIVE_TOKEN, activeUser.id);
  activeUser.auth_token = ACTIVE_TOKEN;
});

describe('POST /api/v1/watcher/sync', () => {
  it('should return config with status and limits', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ heartbeat: true, model: 'opus', hooks_intact: true, uptime_seconds: 100 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.poll_interval_ms).toBe(300000);
    expect(res.body.limits).toBeDefined();
    expect(res.body.credit_usage).toBeDefined();
    expect(res.body.commands).toEqual([]);
  });

  it('should deliver pending commands', async () => {
    createWatcherCommand({ user_id: activeUser.id, command: 'upload_logs' });
    createWatcherCommand({ user_id: activeUser.id, command: 'notify', payload: '{"message":"hello"}' });

    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ heartbeat: true });

    expect(res.status).toBe(200);
    expect(res.body.commands.length).toBe(2);
    expect(res.body.commands[0].type).toBe('upload_logs');
    expect(res.body.commands[1].type).toBe('notify');
    expect(res.body.commands[1].message).toBe('hello');

    // Commands should be marked delivered
    const pending = getPendingWatcherCommands(activeUser.id);
    expect(pending.length).toBe(0);
  });
});

describe('POST /api/v1/watcher/logs', () => {
  it('should save uploaded logs', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/logs')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ hook_log: 'hook log content', watcher_log: 'watcher log content' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const logs = getLatestWatcherLogs(activeUser.id);
    expect(logs).toBeDefined();
    expect(logs!.hook_log).toBe('hook log content');
    expect(logs!.watcher_log).toBe('watcher log content');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/watcher-api.ts packages/server/src/server.ts packages/server/tests/watcher-api.test.ts
git commit -m "feat(server): watcher sync + logs endpoints with tests"
```

---

### Task 4: Server — Admin Watcher Endpoints

**Files:**
- Modify: `packages/server/src/routes/admin-api.ts`

- [ ] **Step 1: Add watcher admin endpoints**

Add to the end of `packages/server/src/routes/admin-api.ts` (before the final export):

```typescript
import { createWatcherCommand, getLatestWatcherLogs } from '../services/db.js';
import { sendToWatcher, isWatcherConnected } from '../services/watcher-ws.js';
```

Then add endpoints:

```typescript
// ---------------------------------------------------------------------------
// POST /users/:id/watcher/command — Queue command for watcher
// ---------------------------------------------------------------------------

adminRouter.post('/users/:id/watcher/command', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const { command, message } = req.body;
    if (!command) { res.status(400).json({ error: 'command required' }); return; }

    const payload = message ? JSON.stringify({ message }) : undefined;
    const cmd = createWatcherCommand({ user_id: user.id, command, payload });

    // Try instant delivery via WebSocket
    const delivered = sendToWatcher(user.id, command, message ? { message } : undefined);
    if (delivered) {
      markWatcherCommandDelivered(cmd.id);
    }

    res.json({ id: cmd.id, delivered, status: delivered ? 'delivered' : 'queued' });
  } catch (err) {
    console.error('[admin-api] watcher command error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/watcher/logs — View uploaded logs
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/watcher/logs', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    const logs = getLatestWatcherLogs(user.id);
    res.json({ data: logs || null });
  } catch (err) {
    console.error('[admin-api] watcher logs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /users/:id/watcher/status — Watcher connection status
// ---------------------------------------------------------------------------

adminRouter.get('/users/:id/watcher/status', (req: Request, res: Response) => {
  try {
    const user = getUserById(req.params.id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    res.json({
      connected: isWatcherConnected(user.id),
      last_event_at: user.last_event_at,
    });
  } catch (err) {
    console.error('[admin-api] watcher status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

- [ ] **Step 2: Add missing imports to admin-api.ts**

Make sure these are imported from db.ts:

```typescript
import { markWatcherCommandDelivered } from '../services/db.js';
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/admin-api.ts
git commit -m "feat(server): admin watcher endpoints — command, logs, status"
```

---

### Task 5: Server — Remove Tamper Alerts Completely

**Files:**
- Modify: `packages/server/src/routes/hook-api.ts`
- Modify: `packages/server/src/routes/admin-api.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Clean up hook-api.ts**

In `hook-api.ts`, remove the unused `createTamperAlert` import (if still present — it was removed in an earlier commit but verify). Also remove `autoResolveInactiveAlerts` import and all calls to `maybeResolveInactiveAlerts()` in every endpoint handler. The dead man's switch now handles inactivity via the watcher heartbeat.

- [ ] **Step 2: Remove tamper alert UI from admin-api.ts**

The tamper alert endpoints (`GET /tamper-alerts`, `POST /tamper-alerts/:id/resolve`) can stay — they're harmless and already have tests. Just ensure no new tamper alerts are being created from hook events (already done in earlier commit).

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/hook-api.ts
git commit -m "fix(server): clean up remaining tamper alert references from hook handlers"
```

---

### Task 6: Client — Watcher Process

**Files:**
- Create: `client/clawlens-watcher.mjs`

- [ ] **Step 1: Create the watcher file**

Create `client/clawlens-watcher.mjs` — the full watcher process. This is the largest file. It must be a single file, zero npm deps, Node 18+ built-ins only.

Core structure:

```javascript
#!/usr/bin/env node

// ClawLens Watcher — Background enforcement + sync agent
// Runs as login agent. Monitors hook integrity, syncs config from server,
// sends logs on demand, delivers desktop notifications.
// Usage:
//   node clawlens-watcher.mjs          — start watcher (background)
//   node clawlens-watcher.mjs status   — print status and exit

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, statSync, watchFile, unwatchFile } from 'fs';
import { join, dirname } from 'path';
import { homedir, hostname, platform, release } from 'os';
import { execSync, spawn } from 'child_process';
import { createConnection } from 'net';
import http from 'http';
import https from 'https';

const HOME = homedir();
const HOOKS_DIR = join(HOME, '.claude', 'hooks');
const SETTINGS_FILE = join(HOME, '.claude', 'settings.json');
const PID_FILE = join(HOOKS_DIR, '.clawlens-watcher.pid');
const CONFIG_CACHE = join(HOOKS_DIR, '.clawlens-config.json');
const WATCHER_LOG = join(HOOKS_DIR, '.clawlens-watcher.log');
const DEBUG_LOG = join(HOOKS_DIR, '.clawlens-debug.log');
const VERSION = '1.0.0';

// Read config from env (set by install script in settings.json env block)
const SERVER_URL = process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL || process.env.CLAWLENS_SERVER || '';
const AUTH_TOKEN = process.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN || process.env.CLAWLENS_TOKEN || '';
```

The watcher must include these modules:
1. **Log manager** — `log()` function, 1MB rotation, read for upload
2. **Notifier** — `notify(title, message)` cross-platform desktop notifications with sound
3. **Settings watcher** — `fs.watchFile()` on settings.json, verify hooks, auto-repair
4. **WebSocket client** — connect to `/ws/watcher`, handle messages, reconnect with backoff
5. **Poll fallback** — HTTP POST to `/api/v1/watcher/sync` when WS is down
6. **Command handler** — process `upload_logs`, `kill`, `notify` commands
7. **Status command** — `node clawlens-watcher.mjs status` prints status and exits
8. **PID management** — write PID file, clean up on exit
9. **Main loop** — orchestrate everything

Each module should be implemented as functions within the single file, following the same patterns as `clawlens.mjs` (readJSON, writeJSON helpers, fail-open error handling).

Key implementation details:

**WebSocket for Node 18 (no built-in WebSocket):**
Use raw `http`/`https` upgrade:
```javascript
function connectWebSocket() {
  const url = new URL(SERVER_URL.replace(/^http/, 'ws') + '/ws/watcher?token=' + AUTH_TOKEN);
  const client = (url.protocol === 'wss:' ? https : http).request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'wss:' ? 443 : 80),
    path: url.pathname + url.search,
    headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade', 'Sec-WebSocket-Key': Buffer.from(crypto.randomBytes(16)).toString('base64'), 'Sec-WebSocket-Version': '13' },
  });
  // ... handle upgrade event, parse WebSocket frames
}
```

Note: Raw WebSocket frame parsing is complex. Alternative approach that's simpler and works on Node 18+: use the polling approach as primary (it's more reliable anyway) and only use WebSocket on Node 22+ where `WebSocket` is built-in. Check `typeof WebSocket !== 'undefined'`.

**Simpler approach for Node 18 compat:**
```javascript
const HAS_BUILTIN_WS = typeof globalThis.WebSocket !== 'undefined'; // Node 22+

function connectWebSocket() {
  if (!HAS_BUILTIN_WS) {
    log('WebSocket not available (Node < 22), using poll-only mode');
    return;
  }
  const wsUrl = SERVER_URL.replace(/^http/, 'ws') + '/ws/watcher?token=' + AUTH_TOKEN;
  const ws = new WebSocket(wsUrl);
  // ... standard WebSocket API
}
```

**fs.watchFile for settings.json** (more reliable than fs.watch across platforms):
```javascript
let lastRepairTime = 0;
const DEBOUNCE_MS = 500;

fs.watchFile(SETTINGS_FILE, { interval: 2000 }, () => {
  if (Date.now() - lastRepairTime < DEBOUNCE_MS) return;
  checkAndRepairHooks();
});
```

**Hook repair — the exact hook template:**
```javascript
const HOOK_TEMPLATE = {
  SessionStart: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 5}]}],
  UserPromptSubmit: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}],
  PreToolUse: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  Stop: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}],
  StopFailure: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  SessionEnd: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3, "async": true}]}],
  PostToolUse: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3, "async": true}]}],
  SubagentStart: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  PostToolUseFailure: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 2, "async": true}]}],
  ConfigChange: [{"hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}],
  FileChanged: [{"matcher": "settings.json", "hooks": [{"type": "command", "command": "~/.claude/hooks/clawlens-hook.sh", "timeout": 3}]}],
};
```

**Notification cross-platform:**
```javascript
function notify(title, message) {
  try {
    const p = platform();
    if (p === 'darwin') {
      execSync(`osascript -e 'display notification "${message.replace(/"/g, '\\"')}" with title "${title}" sound name "Ping"'`, { timeout: 5000 });
    } else if (p === 'win32') {
      execSync(`powershell -Command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.BalloonTipTitle = '${title}'; $n.BalloonTipText = '${message.replace(/'/g, "''")}'; $n.ShowBalloonTip(5000); [System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep 6; $n.Dispose()"`, { timeout: 10000 });
    } else {
      execSync(`notify-send "${title}" "${message}" --urgency=normal 2>/dev/null; paplay /usr/share/sounds/freedesktop/stereo/message.oga 2>/dev/null &`, { timeout: 5000 });
    }
  } catch {}
}
```

- [ ] **Step 2: Test watcher locally**

```bash
# Test status command (should say "not running")
node client/clawlens-watcher.mjs status

# Test start (Ctrl+C to stop)
CLAWLENS_DEBUG=1 CLAWLENS_SERVER=http://localhost:3000 CLAWLENS_TOKEN=your_token node client/clawlens-watcher.mjs
```

- [ ] **Step 3: Commit**

```bash
git add client/clawlens-watcher.mjs
git commit -m "feat(client): watcher process — hook repair, WS/poll sync, notifications, status command"
```

---

### Task 7: Client — Hook Handler Backup Spawn

**Files:**
- Modify: `client/clawlens.mjs`

- [ ] **Step 1: Add watcher spawn check to SessionStart**

In `client/clawlens.mjs`, in the `enrichSessionStart` function (or in `main()` after detecting SessionStart), add:

```javascript
// Check if watcher is running, spawn if not
function checkAndSpawnWatcher() {
  const pidFile = join(HOOKS_DIR, '.clawlens-watcher.pid');
  const watcherFile = join(HOOKS_DIR, 'clawlens-watcher.mjs');
  try {
    const pid = readText(pidFile);
    if (pid) {
      // Check if process is alive
      try { process.kill(parseInt(pid, 10), 0); debug(`watcher alive (pid=${pid})`); return; }
      catch { debug(`watcher dead (stale pid=${pid})`); }
    }
    // Spawn watcher
    try {
      const { statSync } = await import('fs');
      statSync(watcherFile);
    } catch { debug(`watcher file not found: ${watcherFile}`); return; }

    debug(`spawning watcher: node ${watcherFile}`);
    const child = spawn('node', [watcherFile], { detached: true, stdio: 'ignore', env: { ...process.env } });
    child.unref();
    debug(`watcher spawned (pid=${child.pid})`);
  } catch (e) {
    debug(`watcher spawn check failed: ${e.message}`);
  }
}
```

Call `checkAndSpawnWatcher()` inside the `if (event === 'SessionStart')` block in `main()`.

- [ ] **Step 2: Import spawn**

Add `spawn` to the existing `child_process` import:

```javascript
import { execSync, spawn } from 'child_process';
```

- [ ] **Step 3: Test**

```bash
echo '{"hook_event_name":"SessionStart","session_id":"test"}' | CLAWLENS_DEBUG=1 CLAWLENS_SERVER=http://localhost:3000 CLAWLENS_TOKEN=fake node client/clawlens.mjs 2>&1 | grep watcher
```

Expected: Should see "watcher alive" or "spawning watcher" in debug output.

- [ ] **Step 4: Commit**

```bash
git add client/clawlens.mjs
git commit -m "feat(client): hook handler spawns watcher on SessionStart if not running"
```

---

### Task 8: Scripts — Install with Watcher

**Files:**
- Modify: `scripts/install.sh`
- Modify: `scripts/install.ps1`

- [ ] **Step 1: Update install.sh**

After the existing step that installs `clawlens.mjs`, add:

```bash
# Install watcher
WATCHER_FILE="$HOOK_DIR/clawlens-watcher.mjs"
if [ -f "$INSTALL_SCRIPT_DIR/../client/clawlens-watcher.mjs" ]; then
  cp "$INSTALL_SCRIPT_DIR/../client/clawlens-watcher.mjs" "$WATCHER_FILE"
else
  curl -fsSL "https://raw.githubusercontent.com/howincodes/clawlens/main/client/clawlens-watcher.mjs" -o "$WATCHER_FILE" || \
    { echo "  ERROR: Could not download clawlens-watcher.mjs"; exit 1; }
fi
chmod 644 "$WATCHER_FILE"
echo "  -> $WATCHER_FILE"

# Setup auto-start login agent
setup_login_agent() {
  case "$(uname)" in
    Darwin)
      PLIST_DIR="$HOME/Library/LaunchAgents"
      PLIST_FILE="$PLIST_DIR/com.clawlens.watcher.plist"
      NODE_PATH="$(which node)"
      mkdir -p "$PLIST_DIR"
      cat > "$PLIST_FILE" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clawlens.watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_PATH</string>
    <string>$WATCHER_FILE</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>$HOOK_DIR/.clawlens-watcher-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CLAUDE_PLUGIN_OPTION_SERVER_URL</key><string>$SERVER_URL</string>
    <key>CLAUDE_PLUGIN_OPTION_AUTH_TOKEN</key><string>$AUTH_TOKEN</string>
  </dict>
</dict>
</plist>
PLISTEOF
      launchctl bootout "gui/$(id -u)/com.clawlens.watcher" 2>/dev/null
      launchctl bootstrap "gui/$(id -u)" "$PLIST_FILE"
      echo "  -> Login agent: $PLIST_FILE"
      ;;
    Linux)
      AUTOSTART_DIR="$HOME/.config/autostart"
      DESKTOP_FILE="$AUTOSTART_DIR/clawlens-watcher.desktop"
      mkdir -p "$AUTOSTART_DIR"
      cat > "$DESKTOP_FILE" << DESKTOPEOF
[Desktop Entry]
Type=Application
Name=ClawLens Watcher
Exec=/bin/bash -c 'CLAUDE_PLUGIN_OPTION_SERVER_URL=$SERVER_URL CLAUDE_PLUGIN_OPTION_AUTH_TOKEN=$AUTH_TOKEN node $WATCHER_FILE'
Hidden=true
X-GNOME-Autostart-enabled=true
DESKTOPEOF
      echo "  -> Login agent: $DESKTOP_FILE"
      ;;
  esac
}

setup_login_agent

# Start watcher now
echo "  Starting watcher..."
CLAUDE_PLUGIN_OPTION_SERVER_URL="$SERVER_URL" CLAUDE_PLUGIN_OPTION_AUTH_TOKEN="$AUTH_TOKEN" node "$WATCHER_FILE" &
disown
echo "  -> Watcher running (pid $!)"
```

- [ ] **Step 2: Update install.ps1**

Add equivalent watcher download and VBS startup shortcut creation for Windows.

- [ ] **Step 3: Commit**

```bash
git add scripts/install.sh scripts/install.ps1
git commit -m "feat(scripts): install.sh/ps1 now installs watcher + login agent"
```

---

### Task 9: Scripts — Full Uninstall

**Files:**
- Rewrite: `scripts/uninstall.sh`
- Create: `scripts/uninstall.ps1`

- [ ] **Step 1: Rewrite uninstall.sh**

Complete rewrite of `scripts/uninstall.sh` that removes everything:

```bash
#!/bin/bash
set -e

echo ""
echo "  ClawLens Uninstaller"
echo "  ===================="
echo ""

HOOK_DIR="$HOME/.claude/hooks"
SETTINGS_FILE="$HOME/.claude/settings.json"

# 1. Stop watcher
PID_FILE="$HOOK_DIR/.clawlens-watcher.pid"
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "  Stopping watcher (pid $PID)..."
    kill "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

# Also kill by process name
pkill -f "clawlens-watcher.mjs" 2>/dev/null || true

# 2. Remove login agent
case "$(uname)" in
  Darwin)
    launchctl bootout "gui/$(id -u)/com.clawlens.watcher" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/com.clawlens.watcher.plist"
    echo "  Removed macOS login agent"
    ;;
  Linux)
    rm -f "$HOME/.config/autostart/clawlens-watcher.desktop"
    echo "  Removed Linux autostart entry"
    ;;
esac

# 3. Remove hook files
echo "  Removing hook files..."
rm -f "$HOOK_DIR/clawlens.mjs"
rm -f "$HOOK_DIR/clawlens-watcher.mjs"
rm -f "$HOOK_DIR/clawlens-hook.sh"

# 4. Remove cache files
echo "  Removing cache files..."
rm -f "$HOOK_DIR/.clawlens-cache.json"
rm -f "$HOOK_DIR/.clawlens-model.txt"
rm -f "$HOOK_DIR/.clawlens-config.json"
rm -f "$HOOK_DIR/.clawlens-watcher.pid"
rm -f "$HOOK_DIR/.clawlens-debug.log"
rm -f "$HOOK_DIR/.clawlens-watcher.log"
rm -f "$HOOK_DIR/.clawlens-watcher-stderr.log"

# 5. Remove hooks from settings.json
if [ -f "$SETTINGS_FILE" ]; then
  echo "  Cleaning settings.json..."
  node -e "
    const fs = require('fs');
    const f = '$SETTINGS_FILE';
    let s = {};
    try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { process.exit(0); }
    // Remove clawlens hooks
    if (s.hooks) {
      for (const [event, groups] of Object.entries(s.hooks)) {
        s.hooks[event] = groups.filter(g => !JSON.stringify(g).includes('clawlens'));
        if (s.hooks[event].length === 0) delete s.hooks[event];
      }
      if (Object.keys(s.hooks).length === 0) delete s.hooks;
    }
    // Remove clawlens env vars
    if (s.env) {
      delete s.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
      delete s.env.CLAUDE_PLUGIN_OPTION_AUTH_TOKEN;
      delete s.env.CLAWLENS_DEBUG;
      if (Object.keys(s.env).length === 0) delete s.env;
    }
    fs.writeFileSync(f, JSON.stringify(s, null, 2));
  "
fi

echo ""
echo "  ============================="
echo "  ClawLens removed completely."
echo "  ============================="
echo ""
```

- [ ] **Step 2: Create uninstall.ps1**

Create `scripts/uninstall.ps1` with equivalent Windows logic (kill process, remove VBS from Startup, remove files, clean settings.json).

- [ ] **Step 3: Commit**

```bash
git add scripts/uninstall.sh scripts/uninstall.ps1
git commit -m "feat(scripts): comprehensive uninstall — removes all ClawLens traces"
```

---

### Task 10: Dashboard — Watcher UI on User Detail

**Files:**
- Modify: `packages/dashboard/src/pages/UserDetail.tsx`
- Modify: `packages/dashboard/src/lib/api.ts`

- [ ] **Step 1: Add API functions**

In `packages/dashboard/src/lib/api.ts`, add:

```typescript
// ── Watcher ───────────────────────────────────────────────
export const getWatcherStatus = (userId: string) => fetchClient(`/users/${userId}/watcher/status`)
export const getWatcherLogs = (userId: string) => fetchClient(`/users/${userId}/watcher/logs`)
export const sendWatcherCommand = (userId: string, command: string, message?: string) =>
  fetchClient(`/users/${userId}/watcher/command`, {
    method: 'POST',
    body: JSON.stringify({ command, message }),
  })
```

- [ ] **Step 2: Add Watcher section to UserDetail.tsx**

Add a new card section after the user info header. Show connection status, last heartbeat, hooks intact status, and action buttons (Request Logs, Send Notification, Kill Now).

The log viewer: when "Request Logs" is clicked, send command, then poll `getWatcherLogs` every 2 seconds for 30 seconds until logs appear. Display in a monospace scrollable panel with tabs for Hook Log / Watcher Log.

- [ ] **Step 3: Build dashboard**

Run: `pnpm --filter dashboard build`
Expected: Builds clean.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/pages/UserDetail.tsx packages/dashboard/src/lib/api.ts
git commit -m "feat(dashboard): watcher status + logs + commands on User Detail page"
```

---

### Task 11: Dashboard — Watcher Dot on Overview

**Files:**
- Modify: `packages/dashboard/src/pages/Overview.tsx`

- [ ] **Step 1: Fetch watcher status for all users**

In the `loadData` function, after fetching users, fetch watcher status for each user. Or more efficiently, add watcher_connected to the users list endpoint response.

Simpler approach: add `watcher_connected` to the `GET /users` response in admin-api.ts by calling `isWatcherConnected(user.id)`.

- [ ] **Step 2: Add connection dot to user cards**

Next to the status badge on each user card, add a small dot:

```tsx
{user.watcher_connected && (
  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" title="Watcher connected" />
)}
{user.watcher_connected === false && user.last_event_at && (
  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title="Watcher disconnected" />
)}
```

- [ ] **Step 3: Build dashboard**

Run: `pnpm --filter dashboard build`
Expected: Builds clean.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/pages/Overview.tsx packages/server/src/routes/admin-api.ts
git commit -m "feat(dashboard): watcher connection dot on Overview user cards"
```

---

### Task 12: Integration Test

- [ ] **Step 1: Run all server tests**

Run: `pnpm --filter @clawlens/server test`
Expected: All tests pass.

- [ ] **Step 2: Build dashboard**

Run: `pnpm --filter dashboard build`
Expected: Builds clean.

- [ ] **Step 3: Manual end-to-end test**

```bash
# Terminal 1: Start server
CLAWLENS_DEBUG=1 PORT=3000 pnpm dev

# Terminal 2: Create a user via dashboard, get token

# Terminal 3: Start watcher
CLAWLENS_DEBUG=1 CLAWLENS_SERVER=http://localhost:3000 CLAWLENS_TOKEN=<token> node client/clawlens-watcher.mjs

# Terminal 4: Test hook
echo '{"hook_event_name":"SessionStart","session_id":"test"}' | CLAWLENS_DEBUG=1 CLAWLENS_SERVER=http://localhost:3000 CLAWLENS_TOKEN=<token> node client/clawlens.mjs

# Test hook repair: edit ~/.claude/settings.json, remove a clawlens hook
# Watcher should detect and repair within 2 seconds

# Test status command:
CLAWLENS_SERVER=http://localhost:3000 CLAWLENS_TOKEN=<token> node client/clawlens-watcher.mjs status

# Test notifications:
# From dashboard → User Detail → Send Notification → "Hello from admin"
# Desktop notification should appear with sound
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: ClawLens Watcher — complete implementation with server, client, dashboard, scripts"
git push origin main
```
