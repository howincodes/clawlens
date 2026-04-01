import { pgTable, serial, text, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const summaries = pgTable('summaries', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  sessionId: varchar('session_id', { length: 255 }),
  period: varchar('period', { length: 50 }),
  summary: text('summary').notNull(),
  categories: text('categories'),
  topics: text('topics'),
  riskLevel: varchar('risk_level', { length: 20 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userProfiles = pgTable('user_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().unique().references(() => users.id),
  profile: text('profile').notNull(),
  version: integer('version').default(1),
  promptCountAtUpdate: integer('prompt_count_at_update').default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const teamPulses = pgTable('team_pulses', {
  id: serial('id').primaryKey(),
  pulse: text('pulse').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});
