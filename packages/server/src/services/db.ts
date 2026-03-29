import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

let db: Database.Database | null = null;

/**
 * Initialize (or re-initialize) the SQLite database.
 * Pass `:memory:` for tests; pass a file path for production.
 */
export function initDb(dbPath: string = ':memory:'): Database.Database {
  db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  return db;
}

/**
 * Return the already-initialized database instance.
 * Throws if initDb() has not been called.
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

/**
 * Close the database connection. Useful for cleanup in tests.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

function runMigrations(database: Database.Database): void {
  database.exec(`
    -- Teams
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id),
      name TEXT NOT NULL,
      email TEXT,
      auth_token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      default_model TEXT DEFAULT 'sonnet',
      subscription_id TEXT,
      deployment_tier TEXT DEFAULT 'standard',
      poll_interval INTEGER DEFAULT 30000,
      last_event_at TEXT,
      hook_integrity_hash TEXT,
      killed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      model TEXT,
      cwd TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      end_reason TEXT,
      prompt_count INTEGER DEFAULT 0,
      total_credits REAL DEFAULT 0
    );

    -- Prompts
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      prompt TEXT,
      response TEXT,
      model TEXT,
      credit_cost REAL DEFAULT 0,
      blocked INTEGER DEFAULT 0,
      block_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Limits (per-user rate limit rules)
    CREATE TABLE IF NOT EXISTS limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      model TEXT,
      value REAL NOT NULL,
      window TEXT DEFAULT 'daily',
      start_hour INTEGER,
      end_hour INTEGER,
      timezone TEXT DEFAULT 'UTC'
    );

    -- Subscriptions
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      subscription_type TEXT DEFAULT 'pro',
      plan_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Alerts (admin notifications)
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      resolved INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tamper alerts
    CREATE TABLE IF NOT EXISTS tamper_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      alert_type TEXT NOT NULL,
      details TEXT,
      resolved INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    -- Hook events (raw event log)
    CREATE TABLE IF NOT EXISTS hook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tool events
    CREATE TABLE IF NOT EXISTS tool_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      tool_name TEXT NOT NULL,
      tool_input TEXT,
      tool_output TEXT,
      success INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Subagent events
    CREATE TABLE IF NOT EXISTS subagent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT,
      agent_id TEXT,
      agent_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- AI Summaries
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      session_id TEXT,
      period TEXT,
      summary TEXT NOT NULL,
      categories TEXT,
      topics TEXT,
      risk_level TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Watcher commands (admin → client commands queue)
    CREATE TABLE IF NOT EXISTS watcher_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      command TEXT NOT NULL,
      payload TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    -- Watcher logs (client → server log uploads)
    CREATE TABLE IF NOT EXISTS watcher_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      hook_log TEXT,
      watcher_log TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_users_token ON users(auth_token);
    CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id);
    CREATE INDEX IF NOT EXISTS idx_prompts_user ON prompts(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_limits_user ON limits(user_id);
    CREATE INDEX IF NOT EXISTS idx_hook_events_user ON hook_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tool_events_user ON tool_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_tamper_alerts_user ON tamper_alerts(user_id);
    CREATE INDEX IF NOT EXISTS idx_watcher_commands_user ON watcher_commands(user_id, status);
  `);

  // Incremental migrations for existing databases
  try {
    database.exec(`ALTER TABLE users ADD COLUMN poll_interval INTEGER DEFAULT 30000`);
  } catch {
    // Column already exists — ignore
  }
}

// ---------------------------------------------------------------------------
// Type definitions for row objects
// ---------------------------------------------------------------------------

export interface TeamRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface UserRow {
  id: string;
  team_id: string;
  name: string;
  email: string | null;
  auth_token: string;
  status: string;
  default_model: string | null;
  subscription_id: string | null;
  deployment_tier: string;
  poll_interval: number | null;
  last_event_at: string | null;
  hook_integrity_hash: string | null;
  killed_at: string | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  model: string | null;
  cwd: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  prompt_count: number;
  total_credits: number;
}

export interface PromptRow {
  id: number;
  session_id: string | null;
  user_id: string;
  prompt: string | null;
  response: string | null;
  model: string | null;
  credit_cost: number;
  blocked: number;
  block_reason: string | null;
  created_at: string;
}

export interface HookEventRow {
  id: number;
  user_id: string;
  session_id: string | null;
  event_type: string;
  payload: string | null;
  created_at: string;
}

export interface ToolEventRow {
  id: number;
  user_id: string;
  session_id: string | null;
  tool_name: string;
  tool_input: string | null;
  tool_output: string | null;
  success: number | null;
  created_at: string;
}

export interface LimitRow {
  id: number;
  user_id: string;
  type: string;
  model: string | null;
  value: number;
  window: string;
  start_hour: number | null;
  end_hour: number | null;
  timezone: string;
}

export interface AlertRow {
  id: number;
  user_id: string | null;
  type: string;
  message: string;
  resolved: number;
  created_at: string;
}

export interface TamperAlertRow {
  id: number;
  user_id: string;
  alert_type: string;
  details: string | null;
  resolved: number;
  created_at: string;
  resolved_at: string | null;
}

export interface SubagentEventRow {
  id: number;
  user_id: string;
  session_id: string | null;
  agent_id: string | null;
  agent_type: string | null;
  created_at: string;
}

export interface SummaryRow {
  id: number;
  user_id: string | null;
  session_id: string | null;
  period: string | null;
  summary: string;
  categories: string | null;
  topics: string | null;
  risk_level: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Teams
// ---------------------------------------------------------------------------

export function createTeam(params: {
  name: string;
  slug: string;
  id?: string;
}): TeamRow {
  const database = getDb();
  const id = params.id ?? randomUUID();
  const stmt = database.prepare(
    `INSERT INTO teams (id, name, slug) VALUES (?, ?, ?) RETURNING *`,
  );
  return stmt.get(id, params.name, params.slug) as TeamRow;
}

export function getTeamById(id: string): TeamRow | undefined {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM teams WHERE id = ?`);
  return stmt.get(id) as TeamRow | undefined;
}

export function getTeamBySlug(slug: string): TeamRow | undefined {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM teams WHERE slug = ?`);
  return stmt.get(slug) as TeamRow | undefined;
}

export function listTeams(): TeamRow[] {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM teams ORDER BY created_at DESC`);
  return stmt.all() as TeamRow[];
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Users
// ---------------------------------------------------------------------------

export function createUser(params: {
  team_id: string;
  name: string;
  email?: string;
  auth_token: string;
  id?: string;
  default_model?: string;
  deployment_tier?: string;
}): UserRow {
  const database = getDb();
  const id = params.id ?? randomUUID();
  const stmt = database.prepare(
    `INSERT INTO users (id, team_id, name, email, auth_token, default_model, deployment_tier)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    id,
    params.team_id,
    params.name,
    params.email ?? null,
    params.auth_token,
    params.default_model ?? 'sonnet',
    params.deployment_tier ?? 'standard',
  ) as UserRow;
}

export function getUserById(id: string): UserRow | undefined {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM users WHERE id = ?`);
  return stmt.get(id) as UserRow | undefined;
}

export function getUserByToken(token: string): UserRow | undefined {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM users WHERE auth_token = ?`);
  return stmt.get(token) as UserRow | undefined;
}

export function getUsersByTeam(teamId: string): UserRow[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM users WHERE team_id = ? ORDER BY created_at DESC`,
  );
  return stmt.all(teamId) as UserRow[];
}

export function updateUser(
  id: string,
  updates: Partial<
    Pick<
      UserRow,
      | 'name'
      | 'email'
      | 'status'
      | 'default_model'
      | 'subscription_id'
      | 'deployment_tier'
      | 'poll_interval'
      | 'last_event_at'
      | 'hook_integrity_hash'
      | 'killed_at'
    >
  >,
): UserRow | undefined {
  const database = getDb();
  const ALLOWED_UPDATE_COLUMNS = new Set(['name', 'email', 'status', 'default_model', 'subscription_id', 'deployment_tier', 'poll_interval', 'last_event_at', 'hook_integrity_hash', 'killed_at']);
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && ALLOWED_UPDATE_COLUMNS.has(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return getUserById(id);

  values.push(id);
  const stmt = database.prepare(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`,
  );
  return stmt.get(...values) as UserRow | undefined;
}

export function deleteUser(id: string): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM users WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Sessions
// ---------------------------------------------------------------------------

export function createSession(params: {
  id: string;
  user_id: string;
  model?: string;
  cwd?: string;
}): SessionRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO sessions (id, user_id, model, cwd)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.id,
    params.user_id,
    params.model ?? null,
    params.cwd ?? null,
  ) as SessionRow;
}

export function getSessionById(id: string): SessionRow | undefined {
  const database = getDb();
  const stmt = database.prepare(`SELECT * FROM sessions WHERE id = ?`);
  return stmt.get(id) as SessionRow | undefined;
}

export function getSessionsByUser(userId: string): SessionRow[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC`,
  );
  return stmt.all(userId) as SessionRow[];
}

export function endSession(
  id: string,
  reason: string,
): SessionRow | undefined {
  const database = getDb();
  const stmt = database.prepare(
    `UPDATE sessions SET ended_at = datetime('now'), end_reason = ? WHERE id = ? RETURNING *`,
  );
  return stmt.get(reason, id) as SessionRow | undefined;
}

export function incrementSessionPromptCount(
  sessionId: string,
  creditCost: number,
): void {
  const database = getDb();
  const stmt = database.prepare(
    `UPDATE sessions SET prompt_count = prompt_count + 1, total_credits = total_credits + ? WHERE id = ?`,
  );
  stmt.run(creditCost, sessionId);
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Prompts
// ---------------------------------------------------------------------------

export function recordPrompt(params: {
  session_id?: string;
  user_id: string;
  prompt?: string;
  response?: string;
  model?: string;
  credit_cost?: number;
  blocked?: boolean;
  block_reason?: string;
}): PromptRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO prompts (session_id, user_id, prompt, response, model, credit_cost, blocked, block_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.session_id ?? null,
    params.user_id,
    params.prompt ?? null,
    params.response ?? null,
    params.model ?? null,
    params.credit_cost ?? 0,
    params.blocked ? 1 : 0,
    params.block_reason ?? null,
  ) as PromptRow;
}

export function getPromptsBySession(sessionId: string): PromptRow[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM prompts WHERE session_id = ? ORDER BY created_at ASC`,
  );
  return stmt.all(sessionId) as PromptRow[];
}

export function getPromptsByUser(
  userId: string,
  limit: number = 50,
): PromptRow[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM prompts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
  );
  return stmt.all(userId, limit) as PromptRow[];
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Hook events
// ---------------------------------------------------------------------------

export function recordHookEvent(params: {
  user_id: string;
  session_id?: string;
  event_type: string;
  payload?: string;
}): HookEventRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO hook_events (user_id, session_id, event_type, payload)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.user_id,
    params.session_id ?? null,
    params.event_type,
    params.payload ?? null,
  ) as HookEventRow;
}

export function getHookEventsByUser(
  userId: string,
  limit: number = 100,
): HookEventRow[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM hook_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
  );
  return stmt.all(userId, limit) as HookEventRow[];
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Tool events
// ---------------------------------------------------------------------------

export function recordToolEvent(params: {
  user_id: string;
  session_id?: string;
  tool_name: string;
  tool_input?: string;
  tool_output?: string;
  success?: boolean;
}): ToolEventRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO tool_events (user_id, session_id, tool_name, tool_input, tool_output, success)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.user_id,
    params.session_id ?? null,
    params.tool_name,
    params.tool_input ?? null,
    params.tool_output ?? null,
    params.success === undefined ? null : params.success ? 1 : 0,
  ) as ToolEventRow;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Subagent events
// ---------------------------------------------------------------------------

export function recordSubagentEvent(params: {
  user_id: string;
  session_id?: string;
  agent_id?: string;
  agent_type?: string;
}): SubagentEventRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO subagent_events (user_id, session_id, agent_id, agent_type)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.user_id,
    params.session_id ?? null,
    params.agent_id ?? null,
    params.agent_type ?? null,
  ) as SubagentEventRow;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Limits
// ---------------------------------------------------------------------------

export function createLimit(params: {
  user_id: string;
  type: string;
  value: number;
  model?: string;
  window?: string;
  start_hour?: number;
  end_hour?: number;
  timezone?: string;
}): LimitRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO limits (user_id, type, model, value, window, start_hour, end_hour, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.user_id,
    params.type,
    params.model ?? null,
    params.value,
    params.window ?? 'daily',
    params.start_hour ?? null,
    params.end_hour ?? null,
    params.timezone ?? 'UTC',
  ) as LimitRow;
}

export function getLimitsByUser(userId: string): LimitRow[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM limits WHERE user_id = ?`,
  );
  return stmt.all(userId) as LimitRow[];
}

export function deleteLimit(id: number): boolean {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM limits WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
}

export function deleteLimitsByUser(userId: string): number {
  const database = getDb();
  const stmt = database.prepare(`DELETE FROM limits WHERE user_id = ?`);
  const result = stmt.run(userId);
  return result.changes;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Alerts
// ---------------------------------------------------------------------------

export function createAlert(params: {
  user_id?: string;
  type: string;
  message: string;
}): AlertRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO alerts (user_id, type, message)
     VALUES (?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.user_id ?? null,
    params.type,
    params.message,
  ) as AlertRow;
}

export function getUnresolvedAlerts(): AlertRow[] {
  const database = getDb();
  const stmt = database.prepare(
    `SELECT * FROM alerts WHERE resolved = 0 ORDER BY created_at DESC`,
  );
  return stmt.all() as AlertRow[];
}

export function resolveAlert(id: number): boolean {
  const database = getDb();
  const stmt = database.prepare(
    `UPDATE alerts SET resolved = 1 WHERE id = ?`,
  );
  const result = stmt.run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Tamper alerts
// ---------------------------------------------------------------------------

export function createTamperAlert(params: {
  user_id: string;
  alert_type: string;
  details?: string;
}): TamperAlertRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO tamper_alerts (user_id, alert_type, details)
     VALUES (?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.user_id,
    params.alert_type,
    params.details ?? null,
  ) as TamperAlertRow;
}

export function getUnresolvedTamperAlerts(userId?: string): TamperAlertRow[] {
  const database = getDb();
  if (userId) {
    const stmt = database.prepare(
      `SELECT * FROM tamper_alerts WHERE user_id = ? AND resolved = 0 ORDER BY created_at DESC`,
    );
    return stmt.all(userId) as TamperAlertRow[];
  }
  const stmt = database.prepare(
    `SELECT * FROM tamper_alerts WHERE resolved = 0 ORDER BY created_at DESC`,
  );
  return stmt.all() as TamperAlertRow[];
}

export function resolveTamperAlert(id: number): boolean {
  const database = getDb();
  const stmt = database.prepare(
    `UPDATE tamper_alerts SET resolved = 1, resolved_at = datetime('now') WHERE id = ?`,
  );
  const result = stmt.run(id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Summaries
// ---------------------------------------------------------------------------

export function createSummary(params: {
  user_id?: string;
  session_id?: string;
  period?: string;
  summary: string;
  categories?: string;
  topics?: string;
  risk_level?: string;
}): SummaryRow {
  const database = getDb();
  const stmt = database.prepare(
    `INSERT INTO summaries (user_id, session_id, period, summary, categories, topics, risk_level)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.user_id ?? null,
    params.session_id ?? null,
    params.period ?? null,
    params.summary,
    params.categories ?? null,
    params.topics ?? null,
    params.risk_level ?? null,
  ) as SummaryRow;
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

export function getUserCreditUsage(
  userId: string,
  window: 'daily' | 'hourly' | 'monthly',
): number {
  const database = getDb();

  let timeFilter: string;
  switch (window) {
    case 'hourly':
      timeFilter = `datetime('now', '-1 hour')`;
      break;
    case 'daily':
      timeFilter = `datetime('now', '-1 day')`;
      break;
    case 'monthly':
      timeFilter = `datetime('now', '-1 month')`;
      break;
  }

  const stmt = database.prepare(
    `SELECT COALESCE(SUM(credit_cost), 0) as total
     FROM prompts
     WHERE user_id = ? AND created_at >= ${timeFilter}`,
  );
  const row = stmt.get(userId) as { total: number };
  return row.total;
}

export function getUserModelCreditUsage(
  userId: string,
  model: string,
  window: 'daily' | 'hourly' | 'monthly',
): number {
  const database = getDb();

  let timeFilter: string;
  switch (window) {
    case 'hourly':
      timeFilter = `datetime('now', '-1 hour')`;
      break;
    case 'daily':
      timeFilter = `datetime('now', '-1 day')`;
      break;
    case 'monthly':
      timeFilter = `datetime('now', '-1 month')`;
      break;
  }

  const stmt = database.prepare(
    `SELECT COALESCE(SUM(credit_cost), 0) as total
     FROM prompts
     WHERE user_id = ? AND model = ? AND created_at >= ${timeFilter}`,
  );
  const row = stmt.get(userId, model) as { total: number };
  return row.total;
}

export function touchUserLastEvent(userId: string): void {
  const database = getDb();
  const stmt = database.prepare(
    `UPDATE users SET last_event_at = datetime('now') WHERE id = ?`,
  );
  stmt.run(userId);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export interface SubscriptionRow {
  id: number;
  email: string;
  subscription_type: string;
  plan_name: string | null;
  created_at: string;
}

export function createSubscription(params: {
  email: string;
  subscription_type?: string;
  plan_name?: string;
}): SubscriptionRow {
  const database = getDb();

  // Upsert: if subscription with this email exists, update it; otherwise create
  const existing = database
    .prepare(`SELECT * FROM subscriptions WHERE email = ? LIMIT 1`)
    .get(params.email) as SubscriptionRow | undefined;

  if (existing) {
    const newType = params.subscription_type || existing.subscription_type;
    const newPlan = params.plan_name ?? existing.plan_name;
    // Always update — don't skip even if values seem the same
    database.prepare(
      `UPDATE subscriptions SET subscription_type = ?, plan_name = ? WHERE id = ?`,
    ).run(newType, newPlan, existing.id);
    return { ...existing, subscription_type: newType, plan_name: newPlan };
  }

  const stmt = database.prepare(
    `INSERT INTO subscriptions (email, subscription_type, plan_name)
     VALUES (?, ?, ?)
     RETURNING *`,
  );
  return stmt.get(
    params.email,
    params.subscription_type ?? 'pro',
    params.plan_name ?? null,
  ) as SubscriptionRow;
}

// ---------------------------------------------------------------------------
// Prepared-statement helpers — Watcher commands
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
    `INSERT INTO watcher_commands (user_id, command, payload) VALUES (?, ?, ?) RETURNING *`,
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
// Prepared-statement helpers — Watcher logs
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
    `INSERT INTO watcher_logs (user_id, hook_log, watcher_log) VALUES (?, ?, ?) RETURNING *`,
  ).get(params.user_id, params.hook_log ?? null, params.watcher_log ?? null) as WatcherLogRow;
}

export function getLatestWatcherLogs(userId: string): WatcherLogRow | undefined {
  const database = getDb();
  return database.prepare(
    `SELECT * FROM watcher_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
  ).get(userId) as WatcherLogRow | undefined;
}
