import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createUser,
  createSession,
  getSessionById,
  getHookEventsByUser,
  incrementSessionPromptCount,
  recordPrompt,
  getPromptsBySession,
  truncateAll,
  type UserRow,
} from '../src/services/db.js';
import { createLimit } from '../src/db/queries/limits.js';
import { updateUser } from '../src/db/queries/users.js';
import { recordMessage } from '../src/db/queries/messages.js';

// ---------------------------------------------------------------------------
// We import the app AFTER initializing DB in beforeEach, but Express app is
// created at module-load time, so we need to ensure initDb is called before
// any request. The app module calls initDb on import, so we re-init with
// test DB in beforeEach.
// ---------------------------------------------------------------------------

import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let activeUser: UserRow;
let killedUser: UserRow;
let pausedUser: UserRow;

const ACTIVE_TOKEN = 'tok-active-hook-test';
const KILLED_TOKEN = 'tok-killed-hook-test';
const PAUSED_TOKEN = 'tok-paused-hook-test';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initDb();
  await truncateAll();

  activeUser = await createUser({
    name: 'Active User',
    auth_token: ACTIVE_TOKEN,
    default_model: 'sonnet',
  });

  killedUser = await createUser({
    name: 'Killed User',
    auth_token: KILLED_TOKEN,
  });
  await updateUser(killedUser.id, { status: 'killed' });
  // Refresh killedUser from DB
  const { getUserById } = await import('../src/db/queries/users.js');
  killedUser = (await getUserById(killedUser.id))!;

  pausedUser = await createUser({
    name: 'Paused User',
    auth_token: PAUSED_TOKEN,
  });
  await updateUser(pausedUser.id, { status: 'paused' });
  pausedUser = (await getUserById(pausedUser.id))!;
});

afterEach(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Helper to build hook payloads
// ---------------------------------------------------------------------------

function basePayload(eventName: string, extra: Record<string, unknown> = {}) {
  return {
    session_id: 'sess-test-001',
    hook_event_name: eventName,
    cwd: '/home/user/project',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Auth tests
// ---------------------------------------------------------------------------

describe('hook auth', () => {
  it('should return 401 when no Authorization header', async () => {
    const res = await request(app)
      .post('/api/v1/hook/session-start')
      .send(basePayload('SessionStart'));

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it('should return 401 for invalid token', async () => {
    const res = await request(app)
      .post('/api/v1/hook/session-start')
      .set('Authorization', 'Bearer tok-does-not-exist')
      .send(basePayload('SessionStart'));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid/);
  });
});

// ---------------------------------------------------------------------------
// POST /session-start
// ---------------------------------------------------------------------------

describe('POST /session-start', () => {
  it('should return 200 {} for active user', async () => {
    const res = await request(app)
      .post('/api/v1/hook/session-start')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload('SessionStart', { model: 'sonnet' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('should return continue:false for killed user', async () => {
    const res = await request(app)
      .post('/api/v1/hook/session-start')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send(basePayload('SessionStart'));

    expect(res.status).toBe(200);
    expect(res.body.continue).toBe(false);
    expect(res.body.stopReason).toMatch(/suspended/i);
  });

  it('should return continue:false for paused user', async () => {
    const res = await request(app)
      .post('/api/v1/hook/session-start')
      .set('Authorization', `Bearer ${PAUSED_TOKEN}`)
      .send(basePayload('SessionStart'));

    expect(res.status).toBe(200);
    expect(res.body.continue).toBe(false);
    expect(res.body.stopReason).toMatch(/paused/i);
  });

  it('should create session in DB', async () => {
    const sessionId = 'sess-create-test';
    await request(app)
      .post('/api/v1/hook/session-start')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload('SessionStart', { session_id: sessionId, model: 'opus' }));

    const session = await getSessionById(sessionId);
    expect(session).toBeDefined();
    expect(session!.userId).toBe(activeUser.id);
    expect(session!.model).toBe('opus');
  });
});

// ---------------------------------------------------------------------------
// POST /prompt
// ---------------------------------------------------------------------------

describe('POST /prompt', () => {
  beforeEach(async () => {
    // Create a session for the active user
    await createSession({
      id: 'sess-test-001',
      user_id: activeUser.id,
      model: 'sonnet',
    });
  });

  it('should return 200 {} for active user with no limits', async () => {
    const res = await request(app)
      .post('/api/v1/hook/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload('UserPromptSubmit', { prompt: 'Hello world' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('should return decision:block for killed user', async () => {
    const res = await request(app)
      .post('/api/v1/hook/prompt')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send(basePayload('UserPromptSubmit', { prompt: 'Hello' }));

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('block');
    expect(res.body.reason).toMatch(/suspended/i);
  });

  it('should return decision:block when over credit limit', async () => {
    // Set a daily limit of 5 credits
    await createLimit({
      userId: activeUser.id,
      type: 'total_credits',
      value: 5,
      window: 'daily',
    });

    // Record some existing usage that puts us near the limit
    await recordMessage({
      provider: 'claude-code',
      sessionId: 'sess-test-001',
      userId: activeUser.id,
      type: 'user',
      content: 'previous prompt',
      model: 'sonnet',
      creditCost: 4,
      sourceType: 'hook',
    });

    // Now try to submit another prompt (sonnet = 3 credits, 4+3 > 5)
    const res = await request(app)
      .post('/api/v1/hook/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload('UserPromptSubmit', { prompt: 'This should be blocked' }));

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('block');
    expect(res.body.reason).toMatch(/Credit limit/);
  });

  it('should record prompt in DB', async () => {
    await request(app)
      .post('/api/v1/hook/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload('UserPromptSubmit', { prompt: 'Test prompt for DB' }));

    const messages = await getPromptsBySession('sess-test-001');
    expect(messages.length).toBeGreaterThanOrEqual(1);
    // Messages are ordered by timestamp desc, so the newest is first
    const last = messages[0];
    expect(last.content).toBe('Test prompt for DB');
    expect(last.creditCost).toBe(3); // sonnet cost
  });
});

// ---------------------------------------------------------------------------
// POST /pre-tool
// ---------------------------------------------------------------------------

describe('POST /pre-tool', () => {
  it('should return 200 {} for active user', async () => {
    await createSession({ id: 'sess-test-001', user_id: activeUser.id });

    const res = await request(app)
      .post('/api/v1/hook/pre-tool')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('PreToolUse', {
          tool_name: 'Read',
          tool_input: { file: 'test.ts' },
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('should return 200 {} for killed user (passthrough endpoint)', async () => {
    const res = await request(app)
      .post('/api/v1/hook/pre-tool')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send(
        basePayload('PreToolUse', {
          tool_name: 'Write',
          tool_input: { file: 'hack.ts' },
        }),
      );

    // pre-tool is a passthrough endpoint — it always returns {}
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

describe('POST /stop', () => {
  it('should record response on existing prompt without double-counting credits', async () => {
    const sessionId = 'sess-stop-test';
    await createSession({ id: sessionId, user_id: activeUser.id, model: 'opus' });

    // Simulate the prompt handler: record prompt with credit_cost already set,
    // and increment session counts (as the prompt handler now does).
    await recordMessage({
      provider: 'claude-code',
      sessionId,
      userId: activeUser.id,
      type: 'user',
      content: 'Do something',
      model: 'opus',
      creditCost: 10,
      sourceType: 'hook',
    });
    await incrementSessionPromptCount(sessionId, 10);

    const res = await request(app)
      .post('/api/v1/hook/stop')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('Stop', {
          session_id: sessionId,
          last_assistant_message: 'Done with the task.',
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Credits should NOT be double-counted — still 10 from the prompt handler
    const session = await getSessionById(sessionId);
    expect(session!.promptCount).toBe(1);
    expect(session!.totalCredits).toBe(10); // opus cost, charged once by prompt handler
  });
});

// ---------------------------------------------------------------------------
// POST /stop-error
// ---------------------------------------------------------------------------

describe('POST /stop-error', () => {
  it('should return 200 {} (passthrough endpoint)', async () => {
    const res = await request(app)
      .post('/api/v1/hook/stop-error')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('StopFailure', {
          error: 'API rate limit exceeded',
          error_details: { code: 429 },
        }),
      );

    // stop-error is a passthrough endpoint — no hook event recording
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// POST /session-end
// ---------------------------------------------------------------------------

describe('POST /session-end', () => {
  it('should end the session', async () => {
    const sessionId = 'sess-end-test';
    await createSession({ id: sessionId, user_id: activeUser.id });

    const res = await request(app)
      .post('/api/v1/hook/session-end')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload('SessionEnd', { session_id: sessionId, reason: 'user_exit' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const session = await getSessionById(sessionId);
    expect(session!.endedAt).toBeTruthy();
    expect(session!.endReason).toBe('user_exit');
  });
});

// ---------------------------------------------------------------------------
// POST /post-tool
// ---------------------------------------------------------------------------

describe('POST /post-tool', () => {
  it('should return 200 {} (passthrough endpoint)', async () => {
    await createSession({ id: 'sess-test-001', user_id: activeUser.id });

    const res = await request(app)
      .post('/api/v1/hook/post-tool')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('PostToolUse', {
          tool_name: 'Read',
          tool_input: { file: 'test.ts' },
          tool_response: 'file contents here',
        }),
      );

    // post-tool is a passthrough endpoint
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// POST /subagent-start
// ---------------------------------------------------------------------------

describe('POST /subagent-start', () => {
  it('should return 200 {} (passthrough endpoint)', async () => {
    const res = await request(app)
      .post('/api/v1/hook/subagent-start')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('SubagentStart', {
          agent_id: 'agent-001',
          agent_type: 'TaskAgent',
        }),
      );

    // subagent-start is a passthrough endpoint
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// POST /post-tool-failure
// ---------------------------------------------------------------------------

describe('POST /post-tool-failure', () => {
  it('should return 200 {} (passthrough endpoint)', async () => {
    const res = await request(app)
      .post('/api/v1/hook/post-tool-failure')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('PostToolUseFailure', {
          tool_name: 'Write',
          error: 'Permission denied',
        }),
      );

    // post-tool-failure is a passthrough endpoint
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// POST /config-change
// ---------------------------------------------------------------------------

describe('POST /config-change', () => {
  it('should create config change event when source contains settings', async () => {
    const res = await request(app)
      .post('/api/v1/hook/config-change')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('ConfigChange', {
          source: 'user-settings',
          file_path: '~/.claude/settings.json',
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('should not create tamper alert when source does not contain settings', async () => {
    const res = await request(app)
      .post('/api/v1/hook/config-change')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('ConfigChange', {
          source: 'environment',
          file_path: '/etc/env',
        }),
      );

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /file-changed
// ---------------------------------------------------------------------------

describe('POST /file-changed', () => {
  it('should record file change event without tamper alert', async () => {
    const res = await request(app)
      .post('/api/v1/hook/file-changed')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('FileChanged', {
          file_path: '~/.claude/hooks.json',
          event: 'modified',
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// POST /antigravity-sync
// ---------------------------------------------------------------------------

describe('POST /antigravity-sync', () => {
  it('should create session and messages from Antigravity data', async () => {
    const cascadeId = 'cascade-test-001';
    const res = await request(app)
      .post('/api/v1/hook/antigravity-sync')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({
        conversations: [
          {
            cascade_id: cascadeId,
            title: 'Test Antigravity Conversation',
            step_count: 3,
            workspaces: ['file:///home/user/project'],
            messages: [
              { role: 'user', content: 'Write a function' },
              { role: 'assistant', content: 'Here is the function...', model: 'gemini-2.5-pro' },
              { role: 'tool', tool_name: 'WriteFile', content: '/tmp/test.ts' },
              { role: 'user', content: 'Add tests' },
              { role: 'assistant', content: 'Here are the tests...', model: 'gemini-2.5-pro' },
            ],
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.synced).toBe(1);

    // Verify session created
    const session = await getSessionById(cascadeId);
    expect(session).toBeDefined();
    expect(session!.userId).toBe(activeUser.id);
    expect(session!.cwd).toBe('/home/user/project');
    expect(session!.promptCount).toBe(3);
  });

  it('should return 200 with empty conversations', async () => {
    const res = await request(app)
      .post('/api/v1/hook/antigravity-sync')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({ conversations: [] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.synced).toBe(0);
  });

  it('should handle missing conversations field gracefully', async () => {
    const res = await request(app)
      .post('/api/v1/hook/antigravity-sync')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.synced).toBe(0);
  });

  it('should require auth', async () => {
    const res = await request(app)
      .post('/api/v1/hook/antigravity-sync')
      .send({ conversations: [] });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });
});
