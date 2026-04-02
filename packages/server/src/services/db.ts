/**
 * Test compatibility layer for the HowinLens server.
 *
 * Wraps the Drizzle+Postgres queries so that tests can import a single module
 * with the same function names the old SQLite-based db.js exported.
 *
 * All functions are async (Drizzle is async).  Tests must `await` every call.
 */

import { sql } from 'drizzle-orm';
import {
  initDb as _initDb,
  getDb as _getDb,
  closeDb as _closeDb,
} from '../db/index.js';
import type { InferSelectModel } from 'drizzle-orm';
import type { users } from '../db/schema/index.js';

// Re-export Drizzle query functions (all already async)
export {
  getUserById,
  getUserByToken,
  getAllUsers,
  updateUser,
  deleteUser,
  touchUserLastEvent,
  getUserCreditUsage,
} from '../db/queries/users.js';

export {
  getSessionById,
  getSessionsByUser,
  endSession,
  incrementSessionPromptCount,
  updateSessionAI,
  upsertAntigravitySession,
} from '../db/queries/sessions.js';

export {
  recordMessage,
  getMessagesBySession,
  getMessagesByUser,
  getUserMessageCount,
} from '../db/queries/messages.js';

export {
  recordHookEvent,
  getHookEventsByUser,
  recordToolEvent,
  recordSubagentEvent,
} from '../db/queries/events.js';

export {
  createLimit,
  getLimitsByUser,
  deleteLimit,
  deleteLimitsByUser,
} from '../db/queries/limits.js';

export {
  createAlert,
  getUnresolvedAlerts,
  resolveAlert,
  createTamperAlert,
  getUnresolvedTamperAlerts,
  resolveTamperAlert,
} from '../db/queries/alerts.js';

export {
  createSubscription,
} from '../db/queries/subscriptions.js';

export {
  createWatcherCommand,
  getPendingWatcherCommands,
  markWatcherCommandDelivered,
  saveWatcherLogs,
  getLatestWatcherLogs,
} from '../db/queries/watcher.js';

export {
  createSummary,
  getUserProfile,
  upsertUserProfile,
  getAllUserProfiles,
  createTeamPulse,
  getLatestTeamPulse,
  getTeamPulseHistory,
} from '../db/queries/ai.js';

export {
  getCreditCostFromDb,
  getModelCredits,
  upsertModelCredit,
  upsertProviderQuota,
  getProviderQuotas,
} from '../db/queries/model-credits.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserRow = InferSelectModel<typeof users>;

/**
 * TeamRow — teams were removed in the Postgres migration.
 * Tests that still reference TeamRow get a lightweight stub type.
 */
export type TeamRow = { id: number; name: string; slug: string };

// ---------------------------------------------------------------------------
// DB lifecycle — thin wrappers around the real Drizzle init/close
// ---------------------------------------------------------------------------

/**
 * Initialise the database connection for tests.
 * Ignores the `path` argument (legacy SQLite `:memory:` compat).
 * Uses DATABASE_URL from env, then falls back to the default test DB URL.
 * Truncates all tables so every test starts clean.
 */
export async function initDb(_path?: string): Promise<void> {
  const url =
    process.env.DATABASE_URL ||
    'postgresql://howinlens:howinlens@localhost:5432/howinlens_test';
  _initDb(url);

  // Seed database (roles, permissions, model_credits, providers, admin user)
  const { seedDatabase } = await import('../db/seed.js');
  await seedDatabase();
}

/**
 * Close the database connection.
 */
export async function closeDb(): Promise<void> {
  await _closeDb();
}

/**
 * Get the raw Drizzle database instance.
 */
export function getDb() {
  return _getDb();
}

// ---------------------------------------------------------------------------
// Truncate helper — used between tests to reset state
// ---------------------------------------------------------------------------

/**
 * Truncate ALL tables and re-seed structural data (roles, model_credits, providers).
 * Call this from beforeEach to get a clean slate.
 */
export async function truncateAll(): Promise<void> {
  const db = _getDb();
  // Truncate everything — seed data will be re-inserted below
  await db.execute(sql`
    TRUNCATE TABLE
      watcher_logs,
      watcher_commands,
      user_profiles,
      team_pulses,
      summaries,
      tamper_alerts,
      alerts,
      subagent_events,
      tool_events,
      hook_events,
      messages,
      limits,
      sessions,
      provider_quotas,
      subscriptions,
      user_roles,
      users,
      role_permissions,
      roles,
      permissions,
      model_credits,
      providers
    CASCADE
  `);

  // Re-seed structural tables (roles, permissions, model_credits, providers, admin user)
  const { seedDatabase } = await import('../db/seed.js');
  await seedDatabase();
}

// ---------------------------------------------------------------------------
// Compat wrappers — match the old test call signatures
// ---------------------------------------------------------------------------

/**
 * createTeam — teams no longer exist in Postgres.
 * Returns a stub object.  The team `id` is a monotonic counter so tests that
 * create multiple teams get distinct ids.
 */
let _teamCounter = 0;
export function createTeam(params: { name: string; slug: string }): TeamRow {
  _teamCounter++;
  return { id: _teamCounter, name: params.name, slug: params.slug };
}

/** Reset team counter between tests */
export function resetTeamCounter(): void {
  _teamCounter = 0;
}

import { createUser as _createUser } from '../db/queries/users.js';

/**
 * createUser — adapts old SQLite params to the Drizzle schema.
 * Old tests pass: { team_id, name, auth_token, default_model, email? }
 * Drizzle expects: { name, email, authToken, defaultModel?, ... }
 */
export async function createUser(params: {
  team_id?: number;
  name: string;
  auth_token: string;
  default_model?: string;
  email?: string;
}): Promise<UserRow> {
  const email =
    params.email ||
    `${params.name.toLowerCase().replace(/\s+/g, '.')}+${Date.now()}@test.local`;
  return _createUser({
    name: params.name,
    email,
    authToken: params.auth_token,
    defaultModel: params.default_model,
  });
}

import { createSession as _createSession } from '../db/queries/sessions.js';

/**
 * createSession — adapts old SQLite params to the Drizzle schema.
 * Old tests pass: { id, user_id, model?, cwd?, source? }
 * Drizzle expects: { id, userId, model?, cwd?, source? }
 */
export async function createSession(params: {
  id: string;
  user_id: number;
  model?: string;
  cwd?: string;
  source?: string;
}) {
  return _createSession({
    id: params.id,
    userId: params.user_id,
    model: params.model,
    cwd: params.cwd,
    source: params.source,
  });
}

import { recordMessage as _recordMessage } from '../db/queries/messages.js';

/**
 * recordPrompt — maps old prompt params to the new messages table.
 * Old tests pass: { session_id, user_id, prompt, response?, model?, credit_cost?, blocked?, block_reason?, source?, turn_id? }
 * Drizzle expects: { provider, sessionId, userId, type, content, model, creditCost, ... }
 */
export async function recordPrompt(params: {
  session_id?: string;
  user_id: number;
  prompt?: string;
  response?: string;
  model?: string;
  credit_cost?: number;
  blocked?: boolean;
  block_reason?: string;
  source?: string;
  turn_id?: string;
}) {
  return _recordMessage({
    provider: params.source || 'claude-code',
    sessionId: params.session_id,
    userId: params.user_id,
    type: 'user',
    content: params.prompt,
    model: params.model,
    creditCost: params.credit_cost ?? 0,
    blocked: params.blocked,
    blockReason: params.block_reason,
    sourceType: 'hook',
    turnId: params.turn_id,
  });
}

/**
 * getPromptsBySession — alias for getMessagesBySession.
 * Returns messages for a session.
 */
import { getMessagesBySession as _getMessagesBySession } from '../db/queries/messages.js';

export async function getPromptsBySession(sessionId: string) {
  return _getMessagesBySession(sessionId);
}

/**
 * getPromptsByUser — alias for getMessagesByUser.
 */
import { getMessagesByUser as _getMessagesByUser } from '../db/queries/messages.js';

export async function getPromptsByUser(userId: number, limit?: number) {
  return _getMessagesByUser(userId, limit);
}

/**
 * getUserPromptCount — alias for getUserMessageCount.
 */
import { getUserMessageCount } from '../db/queries/messages.js';

export async function getUserPromptCount(userId: number): Promise<number> {
  return getUserMessageCount(userId);
}
