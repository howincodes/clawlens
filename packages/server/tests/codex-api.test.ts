import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  initDb,
  closeDb,
  createTeam,
  createUser,
  createLimit,
  getSessionById,
  getDb,
  getProviderQuotas,
  getCreditCostFromDb,
  getPromptsBySession,
  type UserRow,
  type TeamRow,
} from '../src/services/db.js';
import { app } from '../src/server.js';

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let team: TeamRow;
let activeUser: UserRow;
let killedUser: UserRow;
let pausedUser: UserRow;

const ACTIVE_TOKEN = 'tok-active-codex-test';
const KILLED_TOKEN = 'tok-killed-codex-test';
const PAUSED_TOKEN = 'tok-paused-codex-test';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  initDb(':memory:');

  team = createTeam({ name: 'Codex Test Team', slug: 'codex-test' });

  activeUser = createUser({
    team_id: team.id,
    name: 'Active Codex User',
    auth_token: ACTIVE_TOKEN,
    default_model: 'gpt-5.4',
  });

  killedUser = createUser({
    team_id: team.id,
    name: 'Killed Codex User',
    auth_token: KILLED_TOKEN,
  });
  const db = getDb();
  db.prepare(`UPDATE users SET status = 'killed' WHERE id = ?`).run(killedUser.id);
  killedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(killedUser.id) as UserRow;

  pausedUser = createUser({
    team_id: team.id,
    name: 'Paused Codex User',
    auth_token: PAUSED_TOKEN,
  });
  db.prepare(`UPDATE users SET status = 'paused' WHERE id = ?`).run(pausedUser.id);
  pausedUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(pausedUser.id) as UserRow;
});

afterEach(() => {
  closeDb();
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

    const session = getSessionById(sessionId);
    expect(session).toBeDefined();
    expect(session!.user_id).toBe(activeUser.id);
    expect(session!.model).toBe('gpt-5.4');

    // Verify source column is 'codex'
    const db = getDb();
    const row = db.prepare('SELECT source FROM sessions WHERE id = ?').get(sessionId) as { source: string };
    expect(row.source).toBe('codex');
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

  beforeEach(() => {
    // Create a session for the active user with source=codex
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (id, user_id, model, source) VALUES (?, ?, ?, 'codex')`,
    ).run(SESSION_ID, activeUser.id, 'gpt-5.4');
  });

  it('should record prompt with codex credit cost (gpt-5.4 = 10 credits)', async () => {
    const turnId = 'turn-001';
    const res = await request(app)
      .post('/api/v1/codex/prompt')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(basePayload({ prompt: 'Hello from Codex', turn_id: turnId }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Verify the prompt row
    const prompts = getPromptsBySession(SESSION_ID);
    expect(prompts.length).toBeGreaterThanOrEqual(1);
    const last = prompts[prompts.length - 1];
    expect(last.credit_cost).toBe(10); // gpt-5.4 costs 10

    // Verify source and turn_id via raw query (not on PromptRow interface)
    const db = getDb();
    const row = db
      .prepare('SELECT source, turn_id FROM prompts WHERE session_id = ? ORDER BY id DESC LIMIT 1')
      .get(SESSION_ID) as { source: string; turn_id: string };
    expect(row.source).toBe('codex');
    expect(row.turn_id).toBe(turnId);
  });

  it('should block prompt when credit limit exceeded', async () => {
    // Set a daily limit of 5 credits
    createLimit({
      user_id: activeUser.id,
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

  beforeEach(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (id, user_id, model, source) VALUES (?, ?, ?, 'codex')`,
    ).run(SESSION_ID, activeUser.id, 'gpt-5.4');
  });

  it('should record pre and post tool events linked by tool_use_id', async () => {
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

    // Verify tool event was created
    const db = getDb();
    const preTool = db
      .prepare('SELECT * FROM tool_events WHERE tool_use_id = ? AND source = ?')
      .get(TOOL_USE_ID, 'codex') as { tool_name: string; tool_output: string | null; tool_use_id: string; source: string } | undefined;
    expect(preTool).toBeDefined();
    expect(preTool!.tool_name).toBe('Read');
    expect(preTool!.tool_output).toBeNull();

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

    // Verify tool_output is populated after post-tool-use
    const postTool = db
      .prepare('SELECT * FROM tool_events WHERE tool_use_id = ? AND source = ?')
      .get(TOOL_USE_ID, 'codex') as { tool_name: string; tool_output: string | null; success: number | null };
    expect(postTool).toBeDefined();
    expect(postTool!.tool_output).toBe('file contents here');
    expect(postTool!.success).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/codex/stop
// ---------------------------------------------------------------------------

describe('POST /api/v1/codex/stop', () => {
  const SESSION_ID = 'sess-codex-stop';

  beforeEach(() => {
    // Create session and a prompt to update
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (id, user_id, model, source, prompt_count, total_credits)
       VALUES (?, ?, ?, 'codex', 1, 10)`,
    ).run(SESSION_ID, activeUser.id, 'gpt-5.4');

    db.prepare(
      `INSERT INTO prompts (session_id, user_id, prompt, model, credit_cost, source)
       VALUES (?, ?, ?, ?, ?, 'codex')`,
    ).run(SESSION_ID, activeUser.id, 'Do something with Codex', 'gpt-5.4', 10);
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
    const quotas = getProviderQuotas(activeUser.id, 'codex');
    expect(quotas.length).toBe(2);

    const primary = quotas.find((q) => q.window_name === 'primary');
    expect(primary).toBeDefined();
    expect(primary!.used_percent).toBe(42);
    expect(primary!.window_minutes).toBe(60);
    expect(primary!.plan_type).toBe('max');
    expect(primary!.resets_at).toBe(1700000000);

    const secondary = quotas.find((q) => q.window_name === 'secondary');
    expect(secondary).toBeDefined();
    expect(secondary!.used_percent).toBe(15);
    expect(secondary!.window_minutes).toBe(1440);
    expect(secondary!.resets_at).toBe(1700100000);
  });

  it('should update last prompt with response text and token counts', async () => {
    const res = await request(app)
      .post('/api/v1/codex/stop')
      .set('Authorization', `Bearer ${ACTIVE_TOKEN}`)
      .send(
        basePayload({
          session_id: SESSION_ID,
          last_assistant_message: 'Here is the Codex response.',
          input_tokens: 500,
          cached_tokens: 100,
          output_tokens: 200,
          reasoning_tokens: 50,
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});

    // Verify the prompt was updated with response and token counts
    const db = getDb();
    const prompt = db
      .prepare(
        `SELECT response, input_tokens, cached_tokens, output_tokens, reasoning_tokens
         FROM prompts WHERE session_id = ? AND source = 'codex' ORDER BY id DESC LIMIT 1`,
      )
      .get(SESSION_ID) as {
      response: string | null;
      input_tokens: number | null;
      cached_tokens: number | null;
      output_tokens: number | null;
      reasoning_tokens: number | null;
    };

    expect(prompt.response).toBe('Here is the Codex response.');
    expect(prompt.input_tokens).toBe(500);
    expect(prompt.cached_tokens).toBe(100);
    expect(prompt.output_tokens).toBe(200);
    expect(prompt.reasoning_tokens).toBe(50);
  });
});
