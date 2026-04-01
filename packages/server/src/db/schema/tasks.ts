import { pgTable, serial, varchar, text, integer, boolean, date, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { projects } from './projects.js';

export const milestones = pgTable('milestones', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  dueDate: date('due_date'),
  status: varchar('status', { length: 20 }).default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tasks = pgTable('tasks', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).default('open').notNull(),
  priority: varchar('priority', { length: 20 }).default('medium'),
  effort: varchar('effort', { length: 20 }),
  assigneeId: integer('assignee_id').references(() => users.id),
  milestoneId: integer('milestone_id').references(() => milestones.id),
  parentTaskId: integer('parent_task_id'),
  githubIssueId: integer('github_issue_id'),
  githubIssueUrl: varchar('github_issue_url', { length: 500 }),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const taskComments = pgTable('task_comments', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const taskActivity = pgTable('task_activity', {
  id: serial('id').primaryKey(),
  taskId: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id),
  action: varchar('action', { length: 50 }).notNull(),
  oldValue: varchar('old_value', { length: 255 }),
  newValue: varchar('new_value', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const taskStatusConfigs = pgTable('task_status_configs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 7 }),
  position: integer('position').default(0),
  isDoneState: boolean('is_done_state').default(false),
});

export const requirementInputs = pgTable('requirement_inputs', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  inputType: varchar('input_type', { length: 20 }).notNull(),
  content: text('content'),
  fileName: varchar('file_name', { length: 255 }),
  filePath: varchar('file_path', { length: 500 }),
  processed: boolean('processed').default(false),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiTaskSuggestions = pgTable('ai_task_suggestions', {
  id: serial('id').primaryKey(),
  requirementInputId: integer('requirement_input_id').notNull().references(() => requirementInputs.id, { onDelete: 'cascade' }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  suggestedTasks: jsonb('suggested_tasks'),
  status: varchar('status', { length: 20 }).default('pending'),
  reviewedBy: integer('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
