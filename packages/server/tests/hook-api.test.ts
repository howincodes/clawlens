import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createTeam,
  createUser,
  createLimit,
  createSession,
  getSessionById,
  getPromptsBySession,
  getHookEventsByUser,
  incrementSessionPromptCount,
  getUnresolvedTamperAlerts,
  recordPrompt,
  getDb,
  type UserRow,
  type TeamRow,
} from '../src/services/db.js';

// ---------------------------------------------------------------------------
// We import the app AFTER initializing DB in beforeEach, but Express app is
// created at module-load time, so we need to ensure initDb is called before
// any request. The app module calls initDb on import, so we re-init with
// in-memory DB in beforeEach.
// ---------------------------------------------------------------------------

import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let team: TeamRow;
let activeUser: UserRow;
let killedUser: UserRow;
let pausedUser: UserRow;

const ACTIVE_TOKEN = 'tok-active-hook-test';
const KILLED_TOKEN = 'tok-killed-hook-test';
const PAUSED_TOKEN = 'tok-paused-hook-test';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  initDb(':memory:');

  team = createTeam({ name: 'Hook Test Team', slug: 'hook-test' });

  activeUser = createUser({
    team_id: team.id,
    name: 'Active User',
    auth_token: ACTIVE_TOKEN,
    default_model: 'sonnet',
  });

  killedUser = createUser({
    team_id: team.id,
    name: 'Killed User',
    auth_token: KILLED_TOKEN,
  });
  const db = getDb();
  db.prepare(`UPDATE users SET status = 'killed' WHERE id = ?`).run(killedUser.id);
  // Refresh the object
  killedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(killedUser.id) as UserRow;

  pausedUser = createUser({
    team_id: team.id,
    name: 'Paused User',
    auth_token: PAUSED_TOKEN,
  });
  db.prepare(`UPDATE users SET status = 'paused' WHERE id = ?`).run(pausedUser.id);
  pausedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(pausedUser.id) as UserRow;
});

afterEach(() => {
  closeDb();
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

    const session = getSessionById(sessionId);
    expect(session).toBeDefined();
    expect(session!.user_id).toBe(activeUser.id);
    expect(session!.model).toBe('opus');
  });
});

// ---------------------------------------------------------------------------
// POST /prompt
// ---------------------------------------------------------------------------

describe('POST /prompt', () => {
  beforeEach(() => {
    // Create a session for the active user
    createSession({
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
    createLimit({
      user_id: activeUser.id,
      type: 'total_credits',
      value: 5,
      window: 'daily',
    });

    // Record some existing usage that puts us near the limit
    recordPrompt({
      session_id: 'sess-test-001',
      user_id: activeUser.id,
      model: 'sonnet',
      credit_cost: 4,
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

    const prompts = getPromptsBySession('sess-test-001');
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    const last = prompts[prompts.length - 1];
    expect(last.prompt).toBe('Test prompt for DB');
    expect(last.credit_cost).toBe(3); // sonnet cost
  });
});

// ---------------------------------------------------------------------------
// POST /pre-tool
// ---------------------------------------------------------------------------

describe('POST /pre-tool', () => {
  it('should return 200 {} for active user', async () => {
    createSession({ id: 'sess-test-001', user_id: activeUser.id });

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

  it('should return permissionDecision:deny for killed user', async () => {
    const res = await request(app)
      .post('/api/v1/hook/pre-tool')
      .set('Authorization', `Bearer ${KILLED_TOKEN}`)
      .send(
        basePayload('PreToolUse', {
          tool_name: 'Write',
          tool_input: { file: 'hack.ts' },
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.hookSpecificOutput).toBeDefined();
    expect(res.body.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(res.body.hookSpecificOutput.permissionDecisionReason).toMatch(/suspended/i);
  });
});

// ---------------------------------------------------------------------------
// POST /stop
// ---------------------------------------------------------------------------

describe('POST /stop', () => {
  it('should record response on existing prompt without double-counting credits', async () => {
    const sessionId = 'sess-stop-test';
    createSession({ id: sessionId, user_id: activeUser.id, model: 'opus' });

    // Simulate the prompt handler: record prompt with credit_cost already set,
    // and increment session counts (as the prompt handler now does).
    recordPrompt({
      session_id: sessionId,
      user_id: activeUser.id,
      prompt: 'Do something',
      model: 'opus',
      credit_cost: 10,
    });
    incrementSessionPromptCount(sessionId, 10);

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
    const session = getSessionById(sessionId);
    expect(session!.prompt_count).toBe(1);
    expect(session!.total_credits).toBe(10); // opus cost, charged once by prompt handler

    // Response should be recorded on the prompt row
    const prompts = getPromptsBySession(sessionId);
    expect(prompts.length).toBe(1);
    expect(prompts[0].response).toBe('Done with the task.');
  });
});

// ---------------------------------------------------------------------------
// POST /stop-error
// ---------------------------------------------------------------------------

describe('POST /stop-error', () => {
  it('should record error in hook events', async () => {
    const res = await request(app)
      .post('/api/v1/hook/stop-error')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('StopFailure', {
          error: 'API rate limit exceeded',
          error_details: { code: 429 },
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const events = getHookEventsByUser(activeUser.id);
    const stopError = events.find((e) => e.event_type === 'StopFailure');
    expect(stopError).toBeDefined();
    expect(stopError!.payload).toContain('rate limit');
  });
});

// ---------------------------------------------------------------------------
// POST /session-end
// ---------------------------------------------------------------------------

describe('POST /session-end', () => {
  it('should end the session', async () => {
    const sessionId = 'sess-end-test';
    createSession({ id: sessionId, user_id: activeUser.id });

    const res = await request(app)
      .post('/api/v1/hook/session-end')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload('SessionEnd', { session_id: sessionId, reason: 'user_exit' }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const session = getSessionById(sessionId);
    expect(session!.ended_at).toBeTruthy();
    expect(session!.end_reason).toBe('user_exit');
  });
});

// ---------------------------------------------------------------------------
// POST /post-tool
// ---------------------------------------------------------------------------

describe('POST /post-tool', () => {
  it('should record tool event with success', async () => {
    createSession({ id: 'sess-test-001', user_id: activeUser.id });

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

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Check hook event was recorded
    const events = getHookEventsByUser(activeUser.id);
    const postTool = events.find((e) => e.event_type === 'PostToolUse');
    expect(postTool).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /subagent-start
// ---------------------------------------------------------------------------

describe('POST /subagent-start', () => {
  it('should record subagent event', async () => {
    const res = await request(app)
      .post('/api/v1/hook/subagent-start')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('SubagentStart', {
          agent_id: 'agent-001',
          agent_type: 'TaskAgent',
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Check hook event was recorded
    const events = getHookEventsByUser(activeUser.id);
    const subagent = events.find((e) => e.event_type === 'SubagentStart');
    expect(subagent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /post-tool-failure
// ---------------------------------------------------------------------------

describe('POST /post-tool-failure', () => {
  it('should record tool failure', async () => {
    const res = await request(app)
      .post('/api/v1/hook/post-tool-failure')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload('PostToolUseFailure', {
          tool_name: 'Write',
          error: 'Permission denied',
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    const events = getHookEventsByUser(activeUser.id);
    const failure = events.find((e) => e.event_type === 'PostToolUseFailure');
    expect(failure).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /config-change
// ---------------------------------------------------------------------------

describe('POST /config-change', () => {
  it('should create tamper alert when source contains settings', async () => {
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

    const alerts = getUnresolvedTamperAlerts(activeUser.id);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const configAlert = alerts.find((a) => a.alert_type === 'config_changed');
    expect(configAlert).toBeDefined();
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

    const alerts = getUnresolvedTamperAlerts(activeUser.id);
    const configAlert = alerts.find((a) => a.alert_type === 'config_changed');
    expect(configAlert).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /file-changed
// ---------------------------------------------------------------------------

describe('POST /file-changed', () => {
  it('should create tamper alert', async () => {
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

    const alerts = getUnresolvedTamperAlerts(activeUser.id);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const fileAlert = alerts.find((a) => a.alert_type === 'file_changed');
    expect(fileAlert).toBeDefined();
    expect(fileAlert!.details).toContain('hooks.json');
  });
});
