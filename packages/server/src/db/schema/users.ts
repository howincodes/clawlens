import { pgTable, serial, text, varchar, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  authToken: varchar('auth_token', { length: 255 }).unique().notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  defaultModel: varchar('default_model', { length: 100 }).default('sonnet'),
  githubId: varchar('github_id', { length: 100 }),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  subscriptionId: integer('subscription_id'),
  deploymentTier: varchar('deployment_tier', { length: 20 }).default('standard'),
  pollInterval: integer('poll_interval').default(30000),
  notificationConfig: text('notification_config'),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }),
  hookIntegrityHash: varchar('hook_integrity_hash', { length: 255 }),
  killedAt: timestamp('killed_at', { withTimezone: true }),
  antigravityCollection: boolean('antigravity_collection').default(true),
  antigravityInterval: integer('antigravity_interval').default(120000),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
