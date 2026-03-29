import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createTeam,
  createUser,
  createLimit,
  createWatcherCommand,
  getLatestWatcherLogs,
  getPendingWatcherCommands,
  recordPrompt,
  createSession,
  getDb,
  type UserRow,
  type TeamRow,
} from '../src/services/db.js';

import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let team: TeamRow;
let user: UserRow;

const TOKEN = 'tok-watcher-test';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  initDb(':memory:');

  team = createTeam({ name: 'Watcher Test Team', slug: 'watcher-test' });

  user = createUser({
    team_id: team.id,
    name: 'Watcher User',
    auth_token: TOKEN,
    default_model: 'sonnet',
  });
});

afterEach(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// POST /api/v1/watcher/sync
// ---------------------------------------------------------------------------

describe('POST /api/v1/watcher/sync', () => {
  it('should return config with status and limits', async () => {
    // Create a daily limit for the user
    createLimit({
      user_id: user.id,
      type: 'total_credits',
      value: 200,
      window: 'daily',
    });

    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.poll_interval_ms).toBe(300000);
    expect(res.body.limits).toHaveLength(1);
    expect(res.body.limits[0].type).toBe('total_credits');
    expect(res.body.limits[0].value).toBe(200);
    expect(res.body.credit_usage).toBeDefined();
    expect(res.body.credit_usage.used).toBe(0);
    expect(res.body.credit_usage.limit).toBe(200);
    expect(res.body.credit_usage.percent).toBe(0);
    expect(res.body.commands).toEqual([]);
  });

  it('should deliver pending commands and mark them delivered', async () => {
    // Create two pending commands
    createWatcherCommand({
      user_id: user.id,
      command: 'upload_logs',
    });
    createWatcherCommand({
      user_id: user.id,
      command: 'notify',
      payload: JSON.stringify({ message: 'hello' }),
    });

    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true });

    expect(res.status).toBe(200);
    expect(res.body.commands).toHaveLength(2);

    // First command: upload_logs with no payload
    expect(res.body.commands[0].type).toBe('upload_logs');
    expect(res.body.commands[0].id).toBeDefined();

    // Second command: notify with parsed payload spread
    expect(res.body.commands[1].type).toBe('notify');
    expect(res.body.commands[1].message).toBe('hello');

    // Verify commands are now marked as delivered
    const pending = getPendingWatcherCommands(user.id);
    expect(pending).toHaveLength(0);
  });

  it('should update user default_model from heartbeat', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true, model: 'opus' });

    expect(res.status).toBe(200);

    // Verify user was updated
    const db = getDb();
    const updated = db.prepare('SELECT default_model FROM users WHERE id = ?').get(user.id) as { default_model: string };
    expect(updated.default_model).toBe('opus');
  });

  it('should return credit usage when credits have been used', async () => {
    createLimit({
      user_id: user.id,
      type: 'total_credits',
      value: 200,
      window: 'daily',
    });

    // Create a session and record some credit usage
    createSession({ id: 'sess-credit-test', user_id: user.id, model: 'opus' });
    recordPrompt({
      session_id: 'sess-credit-test',
      user_id: user.id,
      model: 'opus',
      credit_cost: 150,
    });

    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true });

    expect(res.status).toBe(200);
    expect(res.body.credit_usage.used).toBe(150);
    expect(res.body.credit_usage.limit).toBe(200);
    expect(res.body.credit_usage.percent).toBe(75);
  });

  it('should update email only if user has no email', async () => {
    // First sync: should set the email
    await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true, subscription_email: 'first@example.com' });

    const db = getDb();
    let updated = db.prepare('SELECT email FROM users WHERE id = ?').get(user.id) as { email: string | null };
    expect(updated.email).toBe('first@example.com');

    // Second sync: should NOT overwrite existing email
    await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true, subscription_email: 'second@example.com' });

    // Need to re-read. But since hookAuth re-reads the user from DB on each request,
    // the user object will have the email set, so the condition (!user.email) is false.
    updated = db.prepare('SELECT email FROM users WHERE id = ?').get(user.id) as { email: string | null };
    expect(updated.email).toBe('first@example.com');
  });

  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .send({ heartbeat: true });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/watcher/logs
// ---------------------------------------------------------------------------

describe('POST /api/v1/watcher/logs', () => {
  it('should save uploaded logs', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/logs')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        hook_log: 'hook log content here',
        watcher_log: 'watcher log content here',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Verify logs were saved
    const logs = getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hook_log).toBe('hook log content here');
    expect(logs!.watcher_log).toBe('watcher log content here');
  });

  it('should return 401 without auth', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/logs')
      .send({
        hook_log: 'some log',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('should handle missing log fields gracefully', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/logs')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Logs saved with null values
    const logs = getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hook_log).toBeNull();
    expect(logs!.watcher_log).toBeNull();
  });

  it('should truncate logs exceeding 512KB', async () => {
    const longLog = 'x'.repeat(600 * 1024); // 600 KB

    const res = await request(app)
      .post('/api/v1/watcher/logs')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        hook_log: longLog,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const logs = getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hook_log!.length).toBe(512 * 1024);
  });

  it('should ignore non-string log fields', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/logs')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        hook_log: 12345,
        watcher_log: { nested: 'object' },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Non-string values are treated as not provided
    const logs = getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hook_log).toBeNull();
    expect(logs!.watcher_log).toBeNull();
  });
});
