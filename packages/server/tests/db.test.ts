import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDb,
  getDb,
  closeDb,
  createTeam,
  getTeamById,
  getTeamBySlug,
  listTeams,
  createUser,
  getUserById,
  getUserByToken,
  getUsersByTeam,
  updateUser,
  deleteUser,
  createSession,
  getSessionById,
  getSessionsByUser,
  endSession,
  incrementSessionPromptCount,
  recordPrompt,
  getPromptsBySession,
  getPromptsByUser,
  recordHookEvent,
  getHookEventsByUser,
  recordToolEvent,
  recordSubagentEvent,
  createLimit,
  getLimitsByUser,
  deleteLimit,
  deleteLimitsByUser,
  createAlert,
  getUnresolvedAlerts,
  resolveAlert,
  createTamperAlert,
  getUnresolvedTamperAlerts,
  resolveTamperAlert,
  createSummary,
  getUserCreditUsage,
  touchUserLastEvent,
  createSubscription,
} from '../src/services/db.js';

// ---------------------------------------------------------------------------
// Fresh in-memory DB before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  initDb(':memory:');
});

afterEach(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// Table creation
// ---------------------------------------------------------------------------

describe('table creation', () => {
  it('should create all expected tables', () => {
    const db = getDb();
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([
      'alerts',
      'hook_events',
      'limits',
      'prompts',
      'sessions',
      'subagent_events',
      'subscriptions',
      'summaries',
      'tamper_alerts',
      'teams',
      'tool_events',
      'users',
    ]);
  });

  it('should create all expected indexes', () => {
    const db = getDb();
    const indexes = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`,
      )
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name).sort();
    expect(indexNames).toContain('idx_users_token');
    expect(indexNames).toContain('idx_users_team');
    expect(indexNames).toContain('idx_sessions_user');
    expect(indexNames).toContain('idx_prompts_session');
    expect(indexNames).toContain('idx_prompts_user');
    expect(indexNames).toContain('idx_limits_user');
    expect(indexNames).toContain('idx_hook_events_user');
    expect(indexNames).toContain('idx_tool_events_user');
    expect(indexNames).toContain('idx_tamper_alerts_user');
  });

  it('should set WAL journal mode (skipped for in-memory)', () => {
    // WAL is not supported for :memory: databases; SQLite falls back to 'memory'.
    // This test validates the pragma was executed without error.
    const db = getDb();
    const row = db.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
    // In-memory DBs report 'memory'; file-backed DBs would report 'wal'.
    expect(['wal', 'memory']).toContain(row.journal_mode);
  });

  it('should have foreign_keys enabled', () => {
    const db = getDb();
    const row = db.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getDb guard
// ---------------------------------------------------------------------------

describe('getDb', () => {
  it('should throw when db is not initialized', () => {
    closeDb();
    expect(() => getDb()).toThrow('Database not initialized');
  });
});

// ---------------------------------------------------------------------------
// Teams CRUD
// ---------------------------------------------------------------------------

describe('teams', () => {
  it('should create a team', () => {
    const team = createTeam({ name: 'Acme Corp', slug: 'acme-corp' });
    expect(team.name).toBe('Acme Corp');
    expect(team.slug).toBe('acme-corp');
    expect(team.id).toBeTruthy();
    expect(team.created_at).toBeTruthy();
  });

  it('should get team by id', () => {
    const team = createTeam({ name: 'Acme', slug: 'acme' });
    const found = getTeamById(team.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Acme');
  });

  it('should get team by slug', () => {
    createTeam({ name: 'Acme', slug: 'acme' });
    const found = getTeamBySlug('acme');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Acme');
  });

  it('should return undefined for non-existent team', () => {
    expect(getTeamById('non-existent')).toBeUndefined();
    expect(getTeamBySlug('non-existent')).toBeUndefined();
  });

  it('should list teams', () => {
    createTeam({ name: 'A', slug: 'a' });
    createTeam({ name: 'B', slug: 'b' });
    const teams = listTeams();
    expect(teams).toHaveLength(2);
  });

  it('should enforce unique slugs', () => {
    createTeam({ name: 'A', slug: 'acme' });
    expect(() => createTeam({ name: 'B', slug: 'acme' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Users CRUD
// ---------------------------------------------------------------------------

describe('users', () => {
  let teamId: string;

  beforeEach(() => {
    const team = createTeam({ name: 'Test Team', slug: 'test-team' });
    teamId = team.id;
  });

  it('should create a user with defaults', () => {
    const user = createUser({
      team_id: teamId,
      name: 'Alice',
      auth_token: 'tok-abc123',
    });
    expect(user.name).toBe('Alice');
    expect(user.team_id).toBe(teamId);
    expect(user.auth_token).toBe('tok-abc123');
    expect(user.status).toBe('active');
    expect(user.default_model).toBe('sonnet');
    expect(user.deployment_tier).toBe('standard');
    expect(user.id).toBeTruthy();
  });

  it('should get user by id', () => {
    const user = createUser({
      team_id: teamId,
      name: 'Bob',
      auth_token: 'tok-bob',
    });
    const found = getUserById(user.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Bob');
  });

  it('should get user by auth token', () => {
    createUser({
      team_id: teamId,
      name: 'Charlie',
      auth_token: 'tok-charlie',
    });
    const found = getUserByToken('tok-charlie');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Charlie');
  });

  it('should return undefined for non-existent token', () => {
    expect(getUserByToken('does-not-exist')).toBeUndefined();
  });

  it('should get users by team', () => {
    createUser({ team_id: teamId, name: 'D', auth_token: 'tok-d' });
    createUser({ team_id: teamId, name: 'E', auth_token: 'tok-e' });
    const users = getUsersByTeam(teamId);
    expect(users).toHaveLength(2);
  });

  it('should update user fields', () => {
    const user = createUser({
      team_id: teamId,
      name: 'Frank',
      auth_token: 'tok-frank',
    });
    const updated = updateUser(user.id, { name: 'Franklin', status: 'paused' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Franklin');
    expect(updated!.status).toBe('paused');
  });

  it('should return existing user when no updates provided', () => {
    const user = createUser({
      team_id: teamId,
      name: 'Grace',
      auth_token: 'tok-grace',
    });
    const same = updateUser(user.id, {});
    expect(same).toBeDefined();
    expect(same!.name).toBe('Grace');
  });

  it('should delete a user', () => {
    const user = createUser({
      team_id: teamId,
      name: 'Hank',
      auth_token: 'tok-hank',
    });
    expect(deleteUser(user.id)).toBe(true);
    expect(getUserById(user.id)).toBeUndefined();
  });

  it('should return false when deleting non-existent user', () => {
    expect(deleteUser('no-such-id')).toBe(false);
  });

  it('should enforce unique auth tokens', () => {
    createUser({ team_id: teamId, name: 'I', auth_token: 'tok-unique' });
    expect(() =>
      createUser({ team_id: teamId, name: 'J', auth_token: 'tok-unique' }),
    ).toThrow();
  });

  it('should touch last_event_at', () => {
    const user = createUser({
      team_id: teamId,
      name: 'Kate',
      auth_token: 'tok-kate',
    });
    expect(user.last_event_at).toBeNull();
    touchUserLastEvent(user.id);
    const refreshed = getUserById(user.id);
    expect(refreshed!.last_event_at).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Sessions CRUD
// ---------------------------------------------------------------------------

describe('sessions', () => {
  let userId: string;

  beforeEach(() => {
    const team = createTeam({ name: 'T', slug: 't' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-u' });
    userId = user.id;
  });

  it('should create a session', () => {
    const session = createSession({
      id: 'sess-001',
      user_id: userId,
      model: 'opus',
      cwd: '/home/user/project',
    });
    expect(session.id).toBe('sess-001');
    expect(session.user_id).toBe(userId);
    expect(session.model).toBe('opus');
    expect(session.prompt_count).toBe(0);
    expect(session.total_credits).toBe(0);
    expect(session.ended_at).toBeNull();
  });

  it('should get session by id', () => {
    createSession({ id: 'sess-002', user_id: userId });
    const found = getSessionById('sess-002');
    expect(found).toBeDefined();
    expect(found!.user_id).toBe(userId);
  });

  it('should get sessions by user', () => {
    createSession({ id: 'sess-a', user_id: userId });
    createSession({ id: 'sess-b', user_id: userId });
    const sessions = getSessionsByUser(userId);
    expect(sessions).toHaveLength(2);
  });

  it('should end a session', () => {
    createSession({ id: 'sess-end', user_id: userId });
    const ended = endSession('sess-end', 'user_exit');
    expect(ended).toBeDefined();
    expect(ended!.ended_at).toBeTruthy();
    expect(ended!.end_reason).toBe('user_exit');
  });

  it('should increment prompt count and credits', () => {
    createSession({ id: 'sess-inc', user_id: userId });
    incrementSessionPromptCount('sess-inc', 1.5);
    incrementSessionPromptCount('sess-inc', 2.0);
    const session = getSessionById('sess-inc');
    expect(session!.prompt_count).toBe(2);
    expect(session!.total_credits).toBeCloseTo(3.5);
  });
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

describe('prompts', () => {
  let userId: string;
  let sessionId: string;

  beforeEach(() => {
    const team = createTeam({ name: 'T', slug: 't' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-p' });
    userId = user.id;
    const session = createSession({ id: 'sess-p', user_id: userId });
    sessionId = session.id;
  });

  it('should record a prompt', () => {
    const prompt = recordPrompt({
      session_id: sessionId,
      user_id: userId,
      prompt: 'Hello',
      response: 'Hi there',
      model: 'sonnet',
      credit_cost: 0.5,
    });
    expect(prompt.id).toBeTruthy();
    expect(prompt.prompt).toBe('Hello');
    expect(prompt.response).toBe('Hi there');
    expect(prompt.credit_cost).toBe(0.5);
    expect(prompt.blocked).toBe(0);
  });

  it('should record a blocked prompt', () => {
    const prompt = recordPrompt({
      user_id: userId,
      prompt: 'Do something bad',
      blocked: true,
      block_reason: 'rate_limit_exceeded',
    });
    expect(prompt.blocked).toBe(1);
    expect(prompt.block_reason).toBe('rate_limit_exceeded');
  });

  it('should get prompts by session', () => {
    recordPrompt({ session_id: sessionId, user_id: userId, prompt: 'A' });
    recordPrompt({ session_id: sessionId, user_id: userId, prompt: 'B' });
    const prompts = getPromptsBySession(sessionId);
    expect(prompts).toHaveLength(2);
  });

  it('should get prompts by user with limit', () => {
    for (let i = 0; i < 5; i++) {
      recordPrompt({ user_id: userId, prompt: `Prompt ${i}` });
    }
    const prompts = getPromptsByUser(userId, 3);
    expect(prompts).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Hook events
// ---------------------------------------------------------------------------

describe('hook events', () => {
  it('should record and retrieve hook events', () => {
    const team = createTeam({ name: 'T', slug: 'te' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-he' });

    recordHookEvent({
      user_id: user.id,
      session_id: 'sess-1',
      event_type: 'SessionStart',
      payload: JSON.stringify({ model: 'opus' }),
    });

    recordHookEvent({
      user_id: user.id,
      event_type: 'Stop',
    });

    const events = getHookEventsByUser(user.id);
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('Stop');
  });
});

// ---------------------------------------------------------------------------
// Tool events
// ---------------------------------------------------------------------------

describe('tool events', () => {
  it('should record a tool event', () => {
    const team = createTeam({ name: 'T', slug: 'too' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-tool' });

    const event = recordToolEvent({
      user_id: user.id,
      session_id: 'sess-tool',
      tool_name: 'Read',
      tool_input: '{"file": "test.ts"}',
      success: true,
    });

    expect(event.tool_name).toBe('Read');
    expect(event.success).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Subagent events
// ---------------------------------------------------------------------------

describe('subagent events', () => {
  it('should record a subagent event', () => {
    const team = createTeam({ name: 'T', slug: 'sub' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-sub' });

    const event = recordSubagentEvent({
      user_id: user.id,
      agent_id: 'agent-001',
      agent_type: 'TaskAgent',
    });

    expect(event.agent_id).toBe('agent-001');
    expect(event.agent_type).toBe('TaskAgent');
  });
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

describe('limits', () => {
  let userId: string;

  beforeEach(() => {
    const team = createTeam({ name: 'T', slug: 'lim' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-lim' });
    userId = user.id;
  });

  it('should create a limit rule', () => {
    const limit = createLimit({
      user_id: userId,
      type: 'total_credits',
      value: 100,
      window: 'daily',
    });
    expect(limit.type).toBe('total_credits');
    expect(limit.value).toBe(100);
    expect(limit.window).toBe('daily');
  });

  it('should get limits by user', () => {
    createLimit({ user_id: userId, type: 'total_credits', value: 100 });
    createLimit({ user_id: userId, type: 'per_model', value: 50, model: 'opus' });
    const limits = getLimitsByUser(userId);
    expect(limits).toHaveLength(2);
  });

  it('should delete a specific limit', () => {
    const limit = createLimit({ user_id: userId, type: 'total_credits', value: 100 });
    expect(deleteLimit(limit.id)).toBe(true);
    expect(getLimitsByUser(userId)).toHaveLength(0);
  });

  it('should delete all limits for a user', () => {
    createLimit({ user_id: userId, type: 'total_credits', value: 100 });
    createLimit({ user_id: userId, type: 'per_model', value: 50 });
    const count = deleteLimitsByUser(userId);
    expect(count).toBe(2);
    expect(getLimitsByUser(userId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

describe('alerts', () => {
  it('should create and resolve alerts', () => {
    const alert = createAlert({
      type: 'info',
      message: 'Test alert',
    });
    expect(alert.resolved).toBe(0);

    let unresolved = getUnresolvedAlerts();
    expect(unresolved).toHaveLength(1);

    resolveAlert(alert.id);
    unresolved = getUnresolvedAlerts();
    expect(unresolved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tamper alerts
// ---------------------------------------------------------------------------

describe('tamper alerts', () => {
  let userId: string;

  beforeEach(() => {
    const team = createTeam({ name: 'T', slug: 'tamp' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-tamp' });
    userId = user.id;
  });

  it('should create a tamper alert', () => {
    const alert = createTamperAlert({
      user_id: userId,
      alert_type: 'hooks_modified',
      details: 'Hook file checksum mismatch',
    });
    expect(alert.alert_type).toBe('hooks_modified');
    expect(alert.resolved).toBe(0);
  });

  it('should get unresolved tamper alerts by user', () => {
    createTamperAlert({ user_id: userId, alert_type: 'inactive' });
    createTamperAlert({ user_id: userId, alert_type: 'config_changed' });
    const alerts = getUnresolvedTamperAlerts(userId);
    expect(alerts).toHaveLength(2);
  });

  it('should get all unresolved tamper alerts', () => {
    createTamperAlert({ user_id: userId, alert_type: 'inactive' });
    const all = getUnresolvedTamperAlerts();
    expect(all).toHaveLength(1);
  });

  it('should resolve a tamper alert', () => {
    const alert = createTamperAlert({ user_id: userId, alert_type: 'inactive' });
    expect(resolveTamperAlert(alert.id)).toBe(true);
    const unresolved = getUnresolvedTamperAlerts(userId);
    expect(unresolved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

describe('summaries', () => {
  it('should create a summary', () => {
    const summary = createSummary({
      user_id: 'user-1',
      period: 'daily',
      summary: 'User worked on feature X',
      categories: JSON.stringify(['coding', 'debugging']),
      risk_level: 'low',
    });
    expect(summary.summary).toBe('User worked on feature X');
    expect(summary.period).toBe('daily');
  });
});

// ---------------------------------------------------------------------------
// Credit usage
// ---------------------------------------------------------------------------

describe('credit usage', () => {
  let userId: string;

  beforeEach(() => {
    const team = createTeam({ name: 'T', slug: 'cred' });
    const user = createUser({ team_id: team.id, name: 'U', auth_token: 'tok-cred' });
    userId = user.id;
  });

  it('should calculate credit usage for a window', () => {
    recordPrompt({ user_id: userId, credit_cost: 1.5 });
    recordPrompt({ user_id: userId, credit_cost: 2.5 });
    recordPrompt({ user_id: userId, credit_cost: 0.5 });

    const daily = getUserCreditUsage(userId, 'daily');
    expect(daily).toBeCloseTo(4.5);
  });

  it('should return 0 when no prompts exist', () => {
    expect(getUserCreditUsage(userId, 'daily')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

describe('subscriptions', () => {
  it('should create a subscription', () => {
    const sub = createSubscription({
      email: 'alice@example.com',
      subscription_type: 'pro',
      plan_name: 'Pro Monthly',
    });
    expect(sub.email).toBe('alice@example.com');
    expect(sub.subscription_type).toBe('pro');
    expect(sub.plan_name).toBe('Pro Monthly');
  });
});
