import { pgTable, serial, varchar, text, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { roles } from './roles.js';

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  githubRepoUrl: varchar('github_repo_url', { length: 500 }),
  githubWebhookId: varchar('github_webhook_id', { length: 100 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const projectMembers = pgTable('project_members', {
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').references(() => roles.id),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  addedBy: integer('added_by'),
}, (table) => [
  primaryKey({ columns: [table.projectId, table.userId] }),
]);
