import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createUser,
  getSessionById,
  getPromptsBySession,
  truncateAll,
  type UserRow,
} from '../src/services/db.js';
import { createLimit } from '../src/db/queries/limits.js';
import { updateUser } from '../src/db/queries/users.js';
import { createSession } from '../src/db/queries/sessions.js';
import { recordMessage } from '../src/db/queries/messages.js';
import { getProviderQuotas } from '../src/db/queries/model-credits.js';
import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let activeUser: UserRow;
let killedUser: UserRow;
let pausedUser: UserRow;

const ACTIVE_TOKEN = 'tok-active-codex-test';
const KILLED_TOKEN = 'tok-killed-codex-test';
const PAUSED_TOKEN = 'tok-paused-codex-test';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initDb();
  await truncateAll();

  activeUser = await createUser({
    name: 'Active Codex User',
    auth_token: ACTIVE_TOKEN,
    default_model: 'gpt-5.4',
  });

  killedUser = await createUser({
    name: 'Killed Codex User',
    auth_token: KILLED_TOKEN,
  });
  await updateUser(killedUser.id, { status: 'killed' });
  const { getUserById } = await import('../src/db/queries/users.js');
  killedUser = (await getUserById(killedUser.id))!;

  pausedUser = await createUser({
    name: 'Paused Codex User',
    auth_token: PAUSED_TOKEN,
  });
  await updateUser(pausedUser.id, { status: 'paused' });
  pausedUser = (await getUserById(pausedUser.id))!;
});

afterEach(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Helper to build codex payloads
// ---------------------------------------------------------------------------

function basePayload(extra: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-codex-001',
    cwd: '/home/user/project',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/codex/session-start
// ---------------------------------------------------------------------------

describe('POST /api/v1/codex/session-start', () => {
  it('should create a codex session with source=codex', async () => {
    const sessionId = 'sess-codex-create';
    const res = await request(app)
      .post('/api/v1/codex/session-start')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload({ session_id: sessionId, model: 'gpt-5.4' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const session = await getSessionById(sessionId);
    expect(session).toBeDefined();
    expect(session!.userId).toBe(activeUser.id);
    expect(session!.model).toBe('gpt-5.4');
    expect(session!.source).toBe('codex');
  });

  it('should block killed user with decision:block, killed:true, hard:true', async () => {
    const res = await request(app)
      .post('/api/v1/codex/session-start')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send(basePayload({ session_id: 'sess-codex-killed' }));

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('block');
    expect(res.body.killed).toBe(true);
    expect(res.body.hard).toBe(true);
  });

  it('should block paused user with decision:block', async () => {
    const res = await request(app)
      .post('/api/v1/codex/session-start')
      .set('Authorization', `Bearer ${PAUSED_TOKEN}`)
      .send(basePayload({ session_id: 'sess-codex-paused' }));

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('block');
    // Paused users do NOT get killed/hard flags
    expect(res.body.killed).toBeUndefined();
    expect(res.body.hard).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/codex/prompt
// ---------------------------------------------------------------------------

describe('POST /api/v1/codex/prompt', () => {
  const SESSION_ID = 'sess-codex-001';

  beforeEach(async () => {
    // Create a session for the active user with source=codex
    await createSession({
      id: SESSION_ID,
      userId: activeUser.id,
      model: 'gpt-5.4',
      source: 'codex',
    });
  });

  it('should record prompt with codex credit cost (gpt-5.4 = 10 credits)', async () => {
    const turnId = 'turn-001';
    const res = await request(app)
      .post('/api/v1/codex/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload({ prompt: 'Hello from Codex', turn_id: turnId }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Verify the message row
    const messages = await getPromptsBySession(SESSION_ID);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    // Messages ordered desc by timestamp, first is newest
    const last = messages[0];
    expect(last.creditCost).toBe(10); // gpt-5.4 costs 10
  });

  it('should block prompt when credit limit exceeded', async () => {
    // Set a daily limit of 5 credits
    await createLimit({
      userId: activeUser.id,
      type: 'total_credits',
      value: 5,
      window: 'daily',
    });

    // gpt-5.4 costs 10, which is > 5 limit, so it should block
    const res = await request(app)
      .post('/api/v1/codex/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload({ prompt: 'This should be blocked' }));

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('block');
    expect(res.body.reason).toMatch(/Credit limit/);
  });

  it('should block killed user prompt', async () => {
    const res = await request(app)
      .post('/api/v1/codex/prompt')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send(basePayload({ prompt: 'Hello from killed user' }));

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('block');
    expect(res.body.killed).toBe(true);
    expect(res.body.hard).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/codex/pre-tool-use & post-tool-use
// ---------------------------------------------------------------------------

describe('Codex tool use', () => {
  const SESSION_ID = 'sess-codex-tool';
  const TOOL_USE_ID = 'tu-codex-001';

  beforeEach(async () => {
    await createSession({
      id: SESSION_ID,
      userId: activeUser.id,
      model: 'gpt-5.4',
      source: 'codex',
    });
  });

  it('should record pre and post tool events', async () => {
    // Pre-tool-use
    const preRes = await request(app)
      .post('/api/v1/codex/pre-tool-use')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload({
          session_id: SESSION_ID,
          tool_name: 'Read',
          tool_input: { file: 'test.ts' },
          tool_use_id: TOOL_USE_ID,
        }),
      );

    expect(preRes.status).toBe(200);
    expect(preRes.body).toEqual({});

    // Post-tool-use
    const postRes = await request(app)
      .post('/api/v1/codex/post-tool-use')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload({
          session_id: SESSION_ID,
          tool_name: 'Read',
          tool_use_id: TOOL_USE_ID,
          tool_response: 'file contents here',
        }),
      );

    expect(postRes.status).toBe(200);
    expect(postRes.body).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/codex/stop
// ---------------------------------------------------------------------------

describe('POST /api/v1/codex/stop', () => {
  const SESSION_ID = 'sess-codex-stop';

  beforeEach(async () => {
    // Create session and a message
    await createSession({
      id: SESSION_ID,
      userId: activeUser.id,
      model: 'gpt-5.4',
      source: 'codex',
    });

    await recordMessage({
      provider: 'codex',
      sessionId: SESSION_ID,
      userId: activeUser.id,
      type: 'user',
      content: 'Do something with Codex',
      model: 'gpt-5.4',
      creditCost: 10,
      sourceType: 'hook',
    });

    // Increment session counts to match
    const { incrementSessionPromptCount } = await import('../src/db/queries/sessions.js');
    await incrementSessionPromptCount(SESSION_ID, 10);
  });

  it('should update provider quotas on stop', async () => {
    const res = await request(app)
      .post('/api/v1/codex/stop')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload({
          session_id: SESSION_ID,
          last_assistant_message: 'Done with Codex task.',
          quota_plan_type: 'max',
          quota_primary_used_percent: 42,
          quota_primary_window_minutes: 60,
          quota_primary_resets_at: 1700000000,
          quota_secondary_used_percent: 15,
          quota_secondary_window_minutes: 1440,
          quota_secondary_resets_at: 1700100000,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Verify provider quotas were upserted
    const quotas = await getProviderQuotas(activeUser.id, 'codex');
    expect(quotas.length).toBe(2);

    const primary = quotas.find((q) => q.windowName === 'primary');
    expect(primary).toBeDefined();
    expect(primary!.usedPercent).toBe(42);
    expect(primary!.windowMinutes).toBe(60);
    expect(primary!.planType).toBe('max');
    expect(primary!.resetsAt).toBe(1700000000);

    const secondary = quotas.find((q) => q.windowName === 'secondary');
    expect(secondary).toBeDefined();
    expect(secondary!.usedPercent).toBe(15);
    expect(secondary!.windowMinutes).toBe(1440);
    expect(secondary!.resetsAt).toBe(1700100000);
  });
});
