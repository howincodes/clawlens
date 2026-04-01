import { pgTable, serial, varchar, integer, real } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const limits = pgTable('limits', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  type: varchar('type', { length: 50 }).notNull(),
  model: varchar('model', { length: 100 }),
  value: real('value').notNull(),
  window: varchar('window', { length: 20 }).default('daily'),
  startHour: integer('start_hour'),
  endHour: integer('end_hour'),
  timezone: varchar('timezone', { length: 50 }).default('UTC'),
  source: varchar('source', { length: 50 }).default('claude_code'),
});
