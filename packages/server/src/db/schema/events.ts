import { pgTable, serial, text, varchar, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const hookEvents = pgTable('hook_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  sessionId: varchar('session_id', { length: 255 }),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  payload: text('payload'),
  source: varchar('source', { length: 50 }).default('claude-code'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const toolEvents = pgTable('tool_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  sessionId: varchar('session_id', { length: 255 }),
  toolName: varchar('tool_name', { length: 100 }).notNull(),
  toolInput: text('tool_input'),
  toolOutput: text('tool_output'),
  success: boolean('success'),
  source: varchar('source', { length: 50 }).default('claude-code'),
  toolUseId: varchar('tool_use_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const subagentEvents = pgTable('subagent_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  sessionId: varchar('session_id', { length: 255 }),
  agentId: varchar('agent_id', { length: 255 }),
  agentType: varchar('agent_type', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
