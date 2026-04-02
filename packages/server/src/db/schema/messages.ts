import { pgTable, serial, text, varchar, integer, real, boolean, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { sessions } from './sessions.js';
import { projects } from './projects.js';

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  uuid: varchar('uuid', { length: 255 }),         // JSONL message UUID — natural dedup key
  parentUuid: varchar('parent_uuid', { length: 255 }), // Conversation threading from JSONL
  provider: varchar('provider', { length: 50 }).notNull(), // 'claude-code' | 'codex' | 'antigravity'
  sessionId: varchar('session_id', { length: 255 }), // JSONL session UUID — no FK (sessions table uses numeric IDs)
  userId: integer('user_id').notNull().references(() => users.id),
  type: varchar('type', { length: 20 }).notNull(), // 'user' | 'assistant'
  content: text('content'),
  model: varchar('model', { length: 100 }),
  rawModel: varchar('raw_model', { length: 255 }),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedTokens: integer('cached_tokens'),
  cacheCreationTokens: integer('cache_creation_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  creditCost: real('credit_cost').default(0),
  cwd: text('cwd'),
  gitBranch: varchar('git_branch', { length: 255 }),
  projectId: integer('project_id').references(() => projects.id),
  blocked: boolean('blocked').default(false),
  blockReason: text('block_reason'),
  sourceType: varchar('source_type', { length: 20 }).notNull(), // 'hook' | 'jsonl' | 'extension' | 'collector'
  turnId: varchar('turn_id', { length: 255 }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow(),
});
