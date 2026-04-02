import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createUser,
  createSession,
  createWatcherCommand,
  getLatestWatcherLogs,
  getPendingWatcherCommands,
  truncateAll,
  type UserRow,
} from '../src/services/db.js';
import { createLimit } from '../src/db/queries/limits.js';
import { recordMessage } from '../src/db/queries/messages.js';
import { updateUser, getUserById } from '../src/db/queries/users.js';

import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let user: UserRow;

const TOKEN = 'tok-watcher-test';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initDb();
  await truncateAll();

  user = await createUser({
    name: 'Watcher User',
    auth_token: TOKEN,
    default_model: 'sonnet',
  });
});

afterEach(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// POST /api/v1/watcher/sync
// ---------------------------------------------------------------------------

describe('POST /api/v1/watcher/sync', () => {
  it('should return config with status and limits', async () => {
    // Create a daily limit for the user
    await createLimit({
      userId: user.id,
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
    expect(res.body.poll_interval_ms).toBe(30000);
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
    await createWatcherCommand({
      userId: user.id,
      command: 'upload_logs',
    });
    await createWatcherCommand({
      userId: user.id,
      command: 'notify',
      payload: JSON.stringify({ message: 'hello' }),
    });

    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true });

    expect(res.status).toBe(200);
    expect(res.body.commands).toHaveLength(2);

    // Commands may arrive in any order (DB-dependent)
    const types = res.body.commands.map((c: any) => c.type).sort();
    expect(types).toEqual(['notify', 'upload_logs']);

    // Verify upload_logs command
    const uploadCmd = res.body.commands.find((c: any) => c.type === 'upload_logs');
    expect(uploadCmd).toBeDefined();
    expect(uploadCmd.id).toBeDefined();

    // Verify notify command with parsed payload
    const notifyCmd = res.body.commands.find((c: any) => c.type === 'notify');
    expect(notifyCmd).toBeDefined();
    expect(notifyCmd.message).toBe('hello');

    // Verify commands are now marked as delivered
    const pending = await getPendingWatcherCommands(user.id);
    expect(pending).toHaveLength(0);
  });

  it('should update user default_model from heartbeat', async () => {
    const res = await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true, model: 'opus' });

    expect(res.status).toBe(200);

    // Verify user was updated
    const updated = await getUserById(user.id);
    expect(updated!.defaultModel).toBe('opus');
  });

  it('should return credit usage when credits have been used', async () => {
    await createLimit({
      userId: user.id,
      type: 'total_credits',
      value: 200,
      window: 'daily',
    });

    // Create a session and record some credit usage
    await createSession({ id: 'sess-credit-test', user_id: user.id, model: 'opus' });
    await recordMessage({
      provider: 'claude-code',
      sessionId: 'sess-credit-test',
      userId: user.id,
      type: 'user',
      content: 'test prompt',
      model: 'opus',
      creditCost: 150,
      sourceType: 'hook',
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
    // Remove the auto-generated email by setting it to empty
    await updateUser(user.id, { email: '' });

    // First sync: should set the email
    await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true, subscription_email: 'first@example.com' });

    let updated = await getUserById(user.id);
    expect(updated!.email).toBe('first@example.com');

    // Second sync: should NOT overwrite existing email
    await request(app)
      .post('/api/v1/watcher/sync')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ heartbeat: true, subscription_email: 'second@example.com' });

    updated = await getUserById(user.id);
    expect(updated!.email).toBe('first@example.com');
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
    const logs = await getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hookLog).toBe('hook log content here');
    expect(logs!.watcherLog).toBe('watcher log content here');
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
    const logs = await getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hookLog).toBeNull();
    expect(logs!.watcherLog).toBeNull();
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

    const logs = await getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hookLog!.length).toBe(512 * 1024);
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
    const logs = await getLatestWatcherLogs(user.id);
    expect(logs).toBeDefined();
    expect(logs!.hookLog).toBeNull();
    expect(logs!.watcherLog).toBeNull();
  });
});
