import { pgTable, serial, varchar, text, integer, real, date, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';

export const fileEvents = pgTable('file_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  projectId: integer('project_id').references(() => projects.id),
  filePath: text('file_path').notNull(),
  eventType: varchar('event_type', { length: 20 }).notNull(),
  sizeDelta: integer('size_delta'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
});

export const appTracking = pgTable('app_tracking', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  appName: varchar('app_name', { length: 200 }),
  windowTitle: text('window_title'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  durationSeconds: integer('duration_seconds'),
  date: date('date').notNull(),
});

export const projectDirectories = pgTable('project_directories', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  projectId: integer('project_id').notNull().references(() => projects.id),
  localPath: text('local_path').notNull(),
  discoveredVia: varchar('discovered_via', { length: 20 }),
  linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow().notNull(),
});

export const activityWindows = pgTable('activity_windows', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  projectId: integer('project_id').references(() => projects.id),
  date: date('date').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  source: varchar('source', { length: 20 }),
  eventCount: integer('event_count').default(0),
});
