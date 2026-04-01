import { pgTable, serial, text, varchar, integer, real, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { sessions } from './sessions.js';

export const prompts = pgTable('prompts', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 255 }).references(() => sessions.id),
  userId: integer('user_id').notNull().references(() => users.id),
  prompt: text('prompt'),
  response: text('response'),
  model: varchar('model', { length: 100 }),
  creditCost: real('credit_cost').default(0),
  blocked: boolean('blocked').default(false),
  blockReason: text('block_reason'),
  source: varchar('source', { length: 50 }).default('claude_code'),
  turnId: varchar('turn_id', { length: 255 }),
  inputTokens: integer('input_tokens'),
  cachedTokens: integer('cached_tokens'),
  outputTokens: integer('output_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
