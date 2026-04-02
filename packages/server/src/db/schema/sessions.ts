import { pgTable, varchar, integer, real, timestamp, text } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const sessions = pgTable('sessions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  model: varchar('model', { length: 100 }),
  cwd: text('cwd'),
  source: varchar('source', { length: 50 }).default('claude-code'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  endReason: varchar('end_reason', { length: 100 }),
  promptCount: integer('prompt_count').default(0),
  totalCredits: real('total_credits').default(0),
  aiSummary: text('ai_summary'),
  aiCategories: text('ai_categories'),
  aiProductivityScore: integer('ai_productivity_score'),
  aiKeyActions: text('ai_key_actions'),
  aiToolsSummary: text('ai_tools_summary'),
  aiAnalyzedAt: timestamp('ai_analyzed_at', { withTimezone: true }),
  cliVersion: varchar('cli_version', { length: 50 }),
  modelProvider: varchar('model_provider', { length: 50 }),
  reasoningEffort: varchar('reasoning_effort', { length: 20 }),
});
