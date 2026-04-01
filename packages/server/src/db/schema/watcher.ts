import { pgTable, serial, text, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const watcherCommands = pgTable('watcher_commands', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  command: varchar('command', { length: 50 }).notNull(),
  payload: text('payload'),
  status: varchar('status', { length: 20 }).default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const watcherLogs = pgTable('watcher_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  hookLog: text('hook_log'),
  watcherLog: text('watcher_log'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
});
