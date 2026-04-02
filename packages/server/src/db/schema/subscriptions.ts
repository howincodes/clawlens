import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core';

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  subscriptionType: varchar('subscription_type', { length: 50 }).default('pro'),
  planName: varchar('plan_name', { length: 100 }),
  source: varchar('source', { length: 50 }).default('claude-code'),
  accountId: varchar('account_id', { length: 255 }),
  orgId: varchar('org_id', { length: 255 }),
  authProvider: varchar('auth_provider', { length: 50 }),
  subscriptionActiveStart: varchar('subscription_active_start', { length: 50 }),
  subscriptionActiveUntil: varchar('subscription_active_until', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
