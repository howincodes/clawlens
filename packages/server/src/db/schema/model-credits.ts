import { pgTable, serial, varchar, integer, real, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const modelCredits = pgTable('model_credits', {
  id: serial('id').primaryKey(),
  source: varchar('source', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }).notNull(),
  credits: integer('credits').default(7),
  tier: varchar('tier', { length: 50 }),
}, (table) => [
  uniqueIndex('model_credits_source_model_idx').on(table.source, table.model),
]);

export const providerQuotas = pgTable('provider_quotas', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  source: varchar('source', { length: 50 }).notNull(),
  windowName: varchar('window_name', { length: 50 }).notNull(),
  planType: varchar('plan_type', { length: 50 }),
  usedPercent: real('used_percent'),
  windowMinutes: integer('window_minutes'),
  resetsAt: integer('resets_at'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('provider_quotas_user_source_window_idx').on(table.userId, table.source, table.windowName),
]);

export const modelAliases = pgTable('model_aliases', {
  id: serial('id').primaryKey(),
  rawName: varchar('raw_name', { length: 255 }).unique().notNull(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull(), // anthropic, openai, google
  family: varchar('family', { length: 50 }), // opus, sonnet, haiku, gpt-5, gemini
  tier: varchar('tier', { length: 20 }), // flagship, mid, mini
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
