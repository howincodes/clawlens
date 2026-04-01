import { pgTable, serial, varchar, text, integer, real, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const subscriptionCredentials = pgTable('subscription_credentials', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  orgId: varchar('org_id', { length: 255 }),
  subscriptionType: varchar('subscription_type', { length: 50 }),
  rateLimitTier: varchar('rate_limit_tier', { length: 100 }),
  isActive: boolean('is_active').default(true),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const credentialAssignments = pgTable('credential_assignments', {
  id: serial('id').primaryKey(),
  credentialId: integer('credential_id').notNull().references(() => subscriptionCredentials.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
});

export const usageSnapshots = pgTable('usage_snapshots', {
  id: serial('id').primaryKey(),
  credentialId: integer('credential_id').notNull().references(() => subscriptionCredentials.id, { onDelete: 'cascade' }),
  fiveHourUtilization: real('five_hour_utilization'),
  sevenDayUtilization: real('seven_day_utilization'),
  opusWeeklyUtilization: real('opus_weekly_utilization'),
  sonnetWeeklyUtilization: real('sonnet_weekly_utilization'),
  fiveHourResetsAt: timestamp('five_hour_resets_at', { withTimezone: true }),
  sevenDayResetsAt: timestamp('seven_day_resets_at', { withTimezone: true }),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
});

export const heartbeats = pgTable('heartbeats', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id).unique(),
  clientVersion: varchar('client_version', { length: 50 }),
  platform: varchar('platform', { length: 20 }),
  watchStatus: varchar('watch_status', { length: 20 }).default('off'),
  activeTaskId: integer('active_task_id'),
  lastPingAt: timestamp('last_ping_at', { withTimezone: true }).defaultNow().notNull(),
});

export const watchEvents = pgTable('watch_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  type: varchar('type', { length: 10 }).notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  source: varchar('source', { length: 20 }),
  latitude: real('latitude'),
  longitude: real('longitude'),
});

export const conversationMessages = pgTable('conversation_messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  sessionId: varchar('session_id', { length: 255 }),
  type: varchar('type', { length: 20 }).notNull(),
  messageContent: text('message_content'),
  model: varchar('model', { length: 100 }),
  rawModel: varchar('raw_model', { length: 255 }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedTokens: integer('cached_tokens'),
  cwd: text('cwd'),
  gitBranch: varchar('git_branch', { length: 255 }),
  timestamp: timestamp('timestamp', { withTimezone: true }),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessionRawJsonl = pgTable('session_raw_jsonl', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  projectPath: text('project_path'),
  rawContent: text('raw_content').notNull(),
  lineCount: integer('line_count'),
  lastOffset: integer('last_offset'),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('session_raw_jsonl_user_session_idx').on(table.userId, table.sessionId),
]);
