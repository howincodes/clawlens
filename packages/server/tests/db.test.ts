import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDb,
  getDb,
  closeDb,
  createUser,
  getUserById,
  getUserByToken,
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
  createWatcherCommand,
  getPendingWatcherCommands,
  markWatcherCommandDelivered,
  saveWatcherLogs,
  getLatestWatcherLogs,
  getUserProfile,
  upsertUserProfile,
  getAllUserProfiles,
  createTeamPulse,
  getLatestTeamPulse,
  getTeamPulseHistory,
  updateSessionAI,
  getUserPromptCount,
  getCreditCostFromDb,
  getModelCredits,
  upsertModelCredit,
  upsertProviderQuota,
  getProviderQuotas,
  truncateAll,
  recordMessage,
} from '../src/services/db.js';
import { getAllUsers } from '../src/db/queries/users.js';

// ---------------------------------------------------------------------------
// Fresh DB before each test
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initDb();
  await truncateAll();
});

afterEach(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// getDb guard
// ---------------------------------------------------------------------------

describe('getDb', () => {
  it('should return a valid Drizzle instance after initDb', () => {
    // getDb returns the Drizzle instance created by initDb
    const db = getDb();
    expect(db).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Users CRUD
// ---------------------------------------------------------------------------

describe('users', () => {
  it('should create a user with defaults', async () => {
    const user = await createUser({
      name: 'Alice',
      auth_token: 'tok-abc123',
    });
    expect(user.name).toBe('Alice');
    expect(user.authToken).toBe('tok-abc123');
    expect(user.status).toBe('active');
    expect(user.defaultModel).toBe('sonnet');
    expect(user.deploymentTier).toBe('standard');
    expect(user.id).toBeTruthy();
  });

  it('should get user by id', async () => {
    const user = await createUser({
      name: 'Bob',
      auth_token: 'tok-bob',
    });
    const found = await getUserById(user.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Bob');
  });

  it('should get user by auth token', async () => {
    await createUser({
      name: 'Charlie',
      auth_token: 'tok-charlie',
    });
    const found = await getUserByToken('tok-charlie');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Charlie');
  });

  it('should return undefined for non-existent token', async () => {
    expect(await getUserByToken('does-not-exist')).toBeUndefined();
  });

  it('should update user fields', async () => {
    const user = await createUser({
      name: 'Frank',
      auth_token: 'tok-frank',
    });
    const updated = await updateUser(user.id, { name: 'Franklin', status: 'paused' });
    expect(updated).toBeDefined();
    expect(updated!.name).toBe('Franklin');
    expect(updated!.status).toBe('paused');
  });

  it('should delete a user', async () => {
    const user = await createUser({
      name: 'Hank',
      auth_token: 'tok-hank',
    });
    expect(await deleteUser(user.id)).toBe(true);
    expect(await getUserById(user.id)).toBeUndefined();
  });

  it('should return false when deleting non-existent user', async () => {
    expect(await deleteUser(999999)).toBe(false);
  });

  it('should enforce unique auth tokens', async () => {
    await createUser({ name: 'I', auth_token: 'tok-unique' });
    await expect(
      createUser({ name: 'J', auth_token: 'tok-unique' }),
    ).rejects.toThrow();
  });

  it('should touch last_event_at', async () => {
    const user = await createUser({
      name: 'Kate',
      auth_token: 'tok-kate',
    });
    expect(user.lastEventAt).toBeNull();
    await touchUserLastEvent(user.id);
    const refreshed = await getUserById(user.id);
    expect(refreshed!.lastEventAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Sessions CRUD
// ---------------------------------------------------------------------------

describe('sessions', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-u-sess' });
    userId = user.id;
  });

  it('should create a session', async () => {
    const session = await createSession({
      id: 'sess-001',
      user_id: userId,
      model: 'opus',
      cwd: '/home/user/project',
    });
    expect(session.id).toBe('sess-001');
    expect(session.userId).toBe(userId);
    expect(session.model).toBe('opus');
    expect(session.promptCount).toBe(0);
    expect(session.totalCredits).toBe(0);
    expect(session.endedAt).toBeNull();
  });

  it('should get session by id', async () => {
    await createSession({ id: 'sess-002', user_id: userId });
    const found = await getSessionById('sess-002');
    expect(found).toBeDefined();
    expect(found!.userId).toBe(userId);
  });

  it('should get sessions by user', async () => {
    await createSession({ id: 'sess-a', user_id: userId });
    await createSession({ id: 'sess-b', user_id: userId });
    const sessions = await getSessionsByUser(userId);
    expect(sessions).toHaveLength(2);
  });

  it('should end a session', async () => {
    await createSession({ id: 'sess-end', user_id: userId });
    const ended = await endSession('sess-end', 'user_exit');
    expect(ended).toBeDefined();
    expect(ended!.endedAt).toBeTruthy();
    expect(ended!.endReason).toBe('user_exit');
  });

  it('should increment prompt count and credits', async () => {
    await createSession({ id: 'sess-inc', user_id: userId });
    await incrementSessionPromptCount('sess-inc', 1.5);
    await incrementSessionPromptCount('sess-inc', 2.0);
    const session = await getSessionById('sess-inc');
    expect(session!.promptCount).toBe(2);
    expect(session!.totalCredits).toBeCloseTo(3.5);
  });
});

// ---------------------------------------------------------------------------
// Messages (was Prompts)
// ---------------------------------------------------------------------------

describe('messages', () => {
  let userId: number;
  let sessionId: string;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-p-msg' });
    userId = user.id;
    const session = await createSession({ id: 'sess-p', user_id: userId });
    sessionId = session.id;
  });

  it('should record a message via recordPrompt compat', async () => {
    const msg = await recordPrompt({
      session_id: sessionId,
      user_id: userId,
      prompt: 'Hello',
      model: 'sonnet',
      credit_cost: 0.5,
    });
    expect(msg.id).toBeTruthy();
    expect(msg.content).toBe('Hello');
    expect(msg.creditCost).toBe(0.5);
    expect(msg.blocked).toBe(false);
  });

  it('should record a blocked message', async () => {
    const msg = await recordPrompt({
      user_id: userId,
      prompt: 'Do something bad',
      blocked: true,
      block_reason: 'rate_limit_exceeded',
    });
    expect(msg.blocked).toBe(true);
    expect(msg.blockReason).toBe('rate_limit_exceeded');
  });

  it('should get messages by session', async () => {
    await recordPrompt({ session_id: sessionId, user_id: userId, prompt: 'A' });
    await recordPrompt({ session_id: sessionId, user_id: userId, prompt: 'B' });
    const messages = await getPromptsBySession(sessionId);
    expect(messages).toHaveLength(2);
  });

  it('should get messages by user with limit', async () => {
    for (let i = 0; i < 5; i++) {
      await recordPrompt({ user_id: userId, prompt: `Prompt ${i}` });
    }
    const messages = await getPromptsByUser(userId, 3);
    expect(messages).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Hook events
// ---------------------------------------------------------------------------

describe('hook events', () => {
  it('should record and retrieve hook events', async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-he' });

    await recordHookEvent({
      userId: user.id,
      sessionId: 'sess-1',
      eventType: 'SessionStart',
      payload: JSON.stringify({ model: 'opus' }),
    });

    await recordHookEvent({
      userId: user.id,
      eventType: 'Stop',
    });

    const events = await getHookEventsByUser(user.id);
    expect(events).toHaveLength(2);
    // Ordered by created_at desc, so Stop is first
    expect(events[0].eventType).toBe('Stop');
  });
});

// ---------------------------------------------------------------------------
// Tool events
// ---------------------------------------------------------------------------

describe('tool events', () => {
  it('should record a tool event', async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-tool' });

    const event = await recordToolEvent({
      userId: user.id,
      sessionId: 'sess-tool',
      toolName: 'Read',
      toolInput: '{"file": "test.ts"}',
      success: true,
    });

    expect(event.toolName).toBe('Read');
    expect(event.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subagent events
// ---------------------------------------------------------------------------

describe('subagent events', () => {
  it('should record a subagent event', async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-sub' });

    const event = await recordSubagentEvent({
      userId: user.id,
      agentId: 'agent-001',
      agentType: 'TaskAgent',
    });

    expect(event.agentId).toBe('agent-001');
    expect(event.agentType).toBe('TaskAgent');
  });
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

describe('limits', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-lim' });
    userId = user.id;
  });

  it('should create a limit rule', async () => {
    const limit = await createLimit({
      userId,
      type: 'total_credits',
      value: 100,
      window: 'daily',
    });
    expect(limit.type).toBe('total_credits');
    expect(limit.value).toBe(100);
    expect(limit.window).toBe('daily');
  });

  it('should get limits by user', async () => {
    await createLimit({ userId, type: 'total_credits', value: 100 });
    await createLimit({ userId, type: 'per_model', value: 50, model: 'opus' });
    const limits = await getLimitsByUser(userId);
    expect(limits).toHaveLength(2);
  });

  it('should delete a specific limit', async () => {
    const limit = await createLimit({ userId, type: 'total_credits', value: 100 });
    expect(await deleteLimit(limit.id)).toBe(true);
    expect(await getLimitsByUser(userId)).toHaveLength(0);
  });

  it('should delete all limits for a user', async () => {
    await createLimit({ userId, type: 'total_credits', value: 100 });
    await createLimit({ userId, type: 'per_model', value: 50 });
    const count = await deleteLimitsByUser(userId);
    expect(count).toBe(2);
    expect(await getLimitsByUser(userId)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

describe('alerts', () => {
  it('should create and resolve alerts', async () => {
    const alert = await createAlert({
      type: 'info',
      message: 'Test alert',
    });
    expect(alert.resolved).toBe(false);

    let unresolved = await getUnresolvedAlerts();
    expect(unresolved).toHaveLength(1);

    await resolveAlert(alert.id);
    unresolved = await getUnresolvedAlerts();
    expect(unresolved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tamper alerts
// ---------------------------------------------------------------------------

describe('tamper alerts', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-tamp' });
    userId = user.id;
  });

  it('should create a tamper alert', async () => {
    const alert = await createTamperAlert({
      userId,
      alertType: 'hooks_modified',
      details: 'Hook file checksum mismatch',
    });
    expect(alert.alertType).toBe('hooks_modified');
    expect(alert.resolved).toBe(false);
  });

  it('should get unresolved tamper alerts by user', async () => {
    await createTamperAlert({ userId, alertType: 'inactive' });
    await createTamperAlert({ userId, alertType: 'config_changed' });
    const alerts = await getUnresolvedTamperAlerts(userId);
    expect(alerts).toHaveLength(2);
  });

  it('should get all unresolved tamper alerts', async () => {
    await createTamperAlert({ userId, alertType: 'inactive' });
    const all = await getUnresolvedTamperAlerts();
    expect(all).toHaveLength(1);
  });

  it('should resolve a tamper alert', async () => {
    const alert = await createTamperAlert({ userId, alertType: 'inactive' });
    expect(await resolveTamperAlert(alert.id)).toBe(true);
    const unresolved = await getUnresolvedTamperAlerts(userId);
    expect(unresolved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

describe('summaries', () => {
  it('should create a summary', async () => {
    const summary = await createSummary({
      period: 'daily',
      summary: 'User worked on feature X',
      categories: JSON.stringify(['coding', 'debugging']),
      riskLevel: 'low',
    });
    expect(summary.summary).toBe('User worked on feature X');
    expect(summary.period).toBe('daily');
  });
});

// ---------------------------------------------------------------------------
// Credit usage
// ---------------------------------------------------------------------------

describe('credit usage', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-cred' });
    userId = user.id;
  });

  it('should calculate credit usage for a window', async () => {
    await recordPrompt({ user_id: userId, credit_cost: 1.5 });
    await recordPrompt({ user_id: userId, credit_cost: 2.5 });
    await recordPrompt({ user_id: userId, credit_cost: 0.5 });

    const daily = await getUserCreditUsage(userId, 'daily');
    expect(daily).toBeCloseTo(4.5);
  });

  it('should return 0 when no messages exist', async () => {
    expect(await getUserCreditUsage(userId, 'daily')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

describe('subscriptions', () => {
  it('should create a subscription', async () => {
    const sub = await createSubscription({
      email: 'alice@example.com',
      subscriptionType: 'pro',
      planName: 'Pro Monthly',
    });
    expect(sub.email).toBe('alice@example.com');
    expect(sub.subscriptionType).toBe('pro');
    expect(sub.planName).toBe('Pro Monthly');
  });
});

// ---------------------------------------------------------------------------
// Watcher commands
// ---------------------------------------------------------------------------

describe('watcher commands', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-wc' });
    userId = user.id;
  });

  it('should create and retrieve pending commands', async () => {
    const cmd = await createWatcherCommand({
      userId,
      command: 'upload_logs',
    });
    expect(cmd.id).toBeTruthy();
    expect(cmd.userId).toBe(userId);
    expect(cmd.command).toBe('upload_logs');
    expect(cmd.status).toBe('pending');
    expect(cmd.payload).toBeNull();
    expect(cmd.createdAt).toBeTruthy();
    expect(cmd.completedAt).toBeNull();

    const pending = await getPendingWatcherCommands(userId);
    expect(pending).toHaveLength(1);
    expect(pending[0].command).toBe('upload_logs');
  });

  it('should mark commands as delivered', async () => {
    const cmd = await createWatcherCommand({
      userId,
      command: 'upload_logs',
    });
    await markWatcherCommandDelivered(cmd.id);

    const pending = await getPendingWatcherCommands(userId);
    expect(pending).toHaveLength(0);
  });

  it('should support payload on commands', async () => {
    const payload = JSON.stringify({ reason: 'debug', maxLines: 500 });
    const cmd = await createWatcherCommand({
      userId,
      command: 'upload_logs',
      payload,
    });
    expect(cmd.payload).toBe(payload);

    const parsed = JSON.parse(cmd.payload!);
    expect(parsed.reason).toBe('debug');
    expect(parsed.maxLines).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Watcher logs
// ---------------------------------------------------------------------------

describe('watcher logs', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-wl' });
    userId = user.id;
  });

  it('should save and retrieve logs', async () => {
    const log = await saveWatcherLogs({
      userId,
      hookLog: 'hook output line 1\nhook output line 2',
      watcherLog: 'watcher started OK',
    });
    expect(log.id).toBeTruthy();
    expect(log.userId).toBe(userId);
    expect(log.hookLog).toBe('hook output line 1\nhook output line 2');
    expect(log.watcherLog).toBe('watcher started OK');
    expect(log.uploadedAt).toBeTruthy();

    const latest = await getLatestWatcherLogs(userId);
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(log.id);
    expect(latest!.hookLog).toBe(log.hookLog);
  });

  it('should return most recent log entry', async () => {
    await saveWatcherLogs({
      userId,
      hookLog: 'old log',
    });
    const newer = await saveWatcherLogs({
      userId,
      hookLog: 'new log',
    });

    const latest = await getLatestWatcherLogs(userId);
    expect(latest).toBeDefined();
    expect(latest!.id).toBe(newer.id);
    expect(latest!.hookLog).toBe('new log');
  });

  it('should return undefined when no logs exist', async () => {
    const latest = await getLatestWatcherLogs(userId);
    expect(latest).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// User Profiles
// ---------------------------------------------------------------------------

describe('user profiles', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'ProfileUser', auth_token: 'tok-up' });
    userId = user.id;
  });

  it('should return undefined when no profile exists', async () => {
    const profile = await getUserProfile(userId);
    expect(profile).toBeUndefined();
  });

  it('should create a profile via upsert', async () => {
    const profile = await upsertUserProfile({
      userId,
      profile: JSON.stringify({ role_estimate: 'Full-stack developer' }),
      promptCountAtUpdate: 10,
    });
    expect(profile.userId).toBe(userId);
    expect(profile.version).toBe(1);
    expect(profile.promptCountAtUpdate).toBe(10);
    expect(JSON.parse(profile.profile).role_estimate).toBe('Full-stack developer');
  });

  it('should update an existing profile via upsert (increment version)', async () => {
    await upsertUserProfile({
      userId,
      profile: JSON.stringify({ role_estimate: 'v1' }),
      promptCountAtUpdate: 5,
    });
    const updated = await upsertUserProfile({
      userId,
      profile: JSON.stringify({ role_estimate: 'v2' }),
      promptCountAtUpdate: 15,
    });
    expect(updated.version).toBe(2);
    expect(updated.promptCountAtUpdate).toBe(15);
    expect(JSON.parse(updated.profile).role_estimate).toBe('v2');
  });

  it('should get profile by user id', async () => {
    await upsertUserProfile({
      userId,
      profile: JSON.stringify({ role_estimate: 'Backend dev' }),
      promptCountAtUpdate: 20,
    });
    const profile = await getUserProfile(userId);
    expect(profile).toBeDefined();
    expect(profile!.userId).toBe(userId);
  });
});

// ---------------------------------------------------------------------------
// Team Pulses
// ---------------------------------------------------------------------------

describe('team pulses', () => {
  it('should create a team pulse', async () => {
    const pulse = await createTeamPulse(JSON.stringify({ headline: 'All systems go' }));
    expect(JSON.parse(pulse.pulse).headline).toBe('All systems go');
    expect(pulse.generatedAt).toBeTruthy();
  });

  it('should get latest team pulse', async () => {
    await createTeamPulse(JSON.stringify({ headline: 'Old' }));
    await createTeamPulse(JSON.stringify({ headline: 'New' }));
    const latest = await getLatestTeamPulse();
    expect(latest).toBeDefined();
    expect(JSON.parse(latest!.pulse).headline).toBe('New');
  });

  it('should return undefined when no pulses exist', async () => {
    const pulse = await getLatestTeamPulse();
    expect(pulse).toBeUndefined();
  });

  it('should get pulse history with limit', async () => {
    for (let i = 0; i < 5; i++) {
      await createTeamPulse(JSON.stringify({ headline: `Pulse ${i}` }));
    }
    const history = await getTeamPulseHistory(3);
    expect(history).toHaveLength(3);
  });

  it('should default to 10 items in pulse history', async () => {
    for (let i = 0; i < 15; i++) {
      await createTeamPulse(JSON.stringify({ headline: `Pulse ${i}` }));
    }
    const history = await getTeamPulseHistory();
    expect(history).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// Session AI
// ---------------------------------------------------------------------------

describe('session AI', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-sai' });
    userId = user.id;
  });

  it('should update session with AI data', async () => {
    await createSession({ id: 'sess-ai', user_id: userId, model: 'sonnet' });
    await updateSessionAI('sess-ai', {
      aiSummary: 'Worked on auth system',
      aiCategories: JSON.stringify(['debugging', 'feature-dev']),
      aiProductivityScore: 85,
      aiKeyActions: JSON.stringify(['Fixed login bug', 'Added tests']),
      aiToolsSummary: 'Heavy use of Read and Edit tools',
    });

    const session = await getSessionById('sess-ai');
    expect(session).toBeDefined();
    expect(session!.aiSummary).toBe('Worked on auth system');
    expect(session!.aiProductivityScore).toBe(85);
    expect(session!.aiToolsSummary).toBe('Heavy use of Read and Edit tools');
    expect(session!.aiAnalyzedAt).toBeTruthy();
    expect(JSON.parse(session!.aiCategories!)).toEqual(['debugging', 'feature-dev']);
    expect(JSON.parse(session!.aiKeyActions!)).toEqual(['Fixed login bug', 'Added tests']);
  });
});

// ---------------------------------------------------------------------------
// User message count
// ---------------------------------------------------------------------------

describe('user message count', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-upc' });
    userId = user.id;
  });

  it('should return 0 when no messages exist', async () => {
    expect(await getUserPromptCount(userId)).toBe(0);
  });

  it('should count all messages for user', async () => {
    await recordPrompt({ user_id: userId, prompt: 'A', credit_cost: 1 });
    await recordPrompt({ user_id: userId, prompt: 'B', credit_cost: 1 });
    await recordPrompt({ user_id: userId, prompt: 'C', credit_cost: 0 });
    // getUserMessageCount counts all messages (not filtered by blocked)
    expect(await getUserPromptCount(userId)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Model Credits
// ---------------------------------------------------------------------------

describe('model credits', () => {
  it('should return seeded credit for known codex model', async () => {
    const credits = await getCreditCostFromDb('gpt-5.4', 'codex');
    expect(credits).toBe(10);
  });

  it('should return default for unknown model', async () => {
    const credits = await getCreditCostFromDb('gpt-99-turbo', 'codex');
    // getCreditCostFromDb returns row.credits or defaults to 7
    expect(credits).toBe(7);
  });

  it('should return seeded credit for known claude_code model', async () => {
    const credits = await getCreditCostFromDb('sonnet', 'claude-code');
    expect(credits).toBe(3);
  });

  it('should update existing credit via upsertModelCredit', async () => {
    // sonnet is seeded at 3
    expect(await getCreditCostFromDb('sonnet', 'claude-code')).toBe(3);
    await upsertModelCredit('claude-code', 'sonnet', 5, 'mid-plus');
    expect(await getCreditCostFromDb('sonnet', 'claude-code')).toBe(5);
    const all = await getModelCredits('claude-code');
    const row = all.find((r) => r.model === 'sonnet');
    expect(row!.tier).toBe('mid-plus');
  });
});

// ---------------------------------------------------------------------------
// Provider Quotas
// ---------------------------------------------------------------------------

describe('provider quotas', () => {
  let userId: number;

  beforeEach(async () => {
    const user = await createUser({ name: 'U', auth_token: 'tok-pq' });
    userId = user.id;
  });

  it('should insert and retrieve a provider quota', async () => {
    await upsertProviderQuota({
      userId,
      source: 'codex',
      windowName: 'daily',
      planType: 'pro',
      usedPercent: 42.5,
      windowMinutes: 1440,
      resetsAt: 1700000000,
    });
    const quotas = await getProviderQuotas(userId, 'codex');
    expect(quotas).toHaveLength(1);
    expect(quotas[0].source).toBe('codex');
    expect(quotas[0].windowName).toBe('daily');
    expect(quotas[0].planType).toBe('pro');
    expect(quotas[0].usedPercent).toBeCloseTo(42.5);
    expect(quotas[0].windowMinutes).toBe(1440);
    expect(quotas[0].resetsAt).toBe(1700000000);
  });

  it('should update on conflict', async () => {
    await upsertProviderQuota({
      userId,
      source: 'codex',
      windowName: 'daily',
      usedPercent: 10,
    });
    await upsertProviderQuota({
      userId,
      source: 'codex',
      windowName: 'daily',
      usedPercent: 75,
      planType: 'team',
    });
    const quotas = await getProviderQuotas(userId, 'codex');
    expect(quotas).toHaveLength(1);
    expect(quotas[0].usedPercent).toBeCloseTo(75);
    expect(quotas[0].planType).toBe('team');
  });
});
