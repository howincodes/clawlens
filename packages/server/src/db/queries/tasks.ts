import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import {
  tasks,
  taskComments,
  taskActivity,
  milestones,
  taskStatusConfigs,
  requirementInputs,
  aiTaskSuggestions,
} from '../schema/index.js';

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(params: {
  projectId: number;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  effort?: string;
  assigneeId?: number;
  milestoneId?: number;
  parentTaskId?: number;
  createdBy?: number;
}) {
  const db = getDb();
  const [task] = await db.insert(tasks).values(params).returning();
  return task;
}

export async function getTaskById(id: number) {
  const db = getDb();
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  return task;
}

export async function getTasksByProject(
  projectId: number,
  filters?: { status?: string; assigneeId?: number; milestoneId?: number },
) {
  const db = getDb();
  const conditions = [eq(tasks.projectId, projectId)];
  if (filters?.status) conditions.push(eq(tasks.status, filters.status));
  if (filters?.assigneeId) conditions.push(eq(tasks.assigneeId, filters.assigneeId));
  if (filters?.milestoneId) conditions.push(eq(tasks.milestoneId, filters.milestoneId));
  return db.select().from(tasks).where(and(...conditions)).orderBy(desc(tasks.createdAt));
}

export async function getTasksByUser(userId: number) {
  const db = getDb();
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.assigneeId, userId))
    .orderBy(desc(tasks.createdAt));
}

export async function updateTask(id: number, updates: Partial<typeof tasks.$inferInsert>) {
  const db = getDb();
  const [task] = await db
    .update(tasks)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return task;
}

export async function deleteTask(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  return result.length > 0;
}

export async function getSubtasks(parentTaskId: number) {
  const db = getDb();
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(desc(tasks.createdAt));
}

// ---------------------------------------------------------------------------
// Task Comments
// ---------------------------------------------------------------------------

export async function addTaskComment(params: {
  taskId: number;
  userId: number;
  content: string;
}) {
  const db = getDb();
  const [comment] = await db.insert(taskComments).values(params).returning();
  return comment;
}

export async function getTaskComments(taskId: number) {
  const db = getDb();
  return db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(desc(taskComments.createdAt));
}

// ---------------------------------------------------------------------------
// Task Activity
// ---------------------------------------------------------------------------

export async function recordTaskActivity(params: {
  taskId: number;
  userId: number;
  action: string;
  oldValue?: string;
  newValue?: string;
}) {
  const db = getDb();
  const [activity] = await db.insert(taskActivity).values(params).returning();
  return activity;
}

export async function getTaskActivity(taskId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(taskActivity)
    .where(eq(taskActivity.taskId, taskId))
    .orderBy(desc(taskActivity.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export async function createMilestone(params: {
  projectId: number;
  name: string;
  description?: string;
  dueDate?: string;
}) {
  const db = getDb();
  const [milestone] = await db.insert(milestones).values(params).returning();
  return milestone;
}

export async function getMilestonesByProject(projectId: number) {
  const db = getDb();
  return db
    .select()
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(desc(milestones.createdAt));
}

export async function updateMilestone(
  id: number,
  updates: Partial<typeof milestones.$inferInsert>,
) {
  const db = getDb();
  const [milestone] = await db
    .update(milestones)
    .set(updates)
    .where(eq(milestones.id, id))
    .returning();
  return milestone;
}

export async function deleteMilestone(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(milestones).where(eq(milestones.id, id)).returning();
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Task Status Configs
// ---------------------------------------------------------------------------

export async function getStatusConfigs(projectId: number) {
  const db = getDb();
  return db
    .select()
    .from(taskStatusConfigs)
    .where(eq(taskStatusConfigs.projectId, projectId));
}

export async function createStatusConfig(params: {
  projectId: number;
  name: string;
  color?: string;
  position?: number;
  isDoneState?: boolean;
}) {
  const db = getDb();
  const [config] = await db.insert(taskStatusConfigs).values(params).returning();
  return config;
}

export async function updateStatusConfig(
  id: number,
  updates: Partial<typeof taskStatusConfigs.$inferInsert>,
) {
  const db = getDb();
  const [config] = await db
    .update(taskStatusConfigs)
    .set(updates)
    .where(eq(taskStatusConfigs.id, id))
    .returning();
  return config;
}

export async function deleteStatusConfig(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(taskStatusConfigs)
    .where(eq(taskStatusConfigs.id, id))
    .returning();
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Requirement Inputs
// ---------------------------------------------------------------------------

export async function createRequirementInput(params: {
  projectId: number;
  inputType: string;
  content?: string;
  fileName?: string;
  filePath?: string;
  createdBy?: number;
}) {
  const db = getDb();
  const [input] = await db.insert(requirementInputs).values(params).returning();
  return input;
}

export async function getRequirementInput(id: number) {
  const db = getDb();
  const [input] = await db
    .select()
    .from(requirementInputs)
    .where(eq(requirementInputs.id, id));
  return input;
}

export async function getRequirementsByProject(projectId: number) {
  const db = getDb();
  return db
    .select()
    .from(requirementInputs)
    .where(eq(requirementInputs.projectId, projectId))
    .orderBy(desc(requirementInputs.createdAt));
}

// ---------------------------------------------------------------------------
// AI Task Suggestions
// ---------------------------------------------------------------------------

export async function createAITaskSuggestion(params: {
  requirementInputId: number;
  projectId: number;
  suggestedTasks: any;
}) {
  const db = getDb();
  const [suggestion] = await db.insert(aiTaskSuggestions).values(params).returning();
  return suggestion;
}

export async function getAITaskSuggestion(id: number) {
  const db = getDb();
  const [suggestion] = await db
    .select()
    .from(aiTaskSuggestions)
    .where(eq(aiTaskSuggestions.id, id));
  return suggestion;
}

export async function updateAITaskSuggestionStatus(
  id: number,
  status: string,
  reviewedBy: number,
) {
  const db = getDb();
  const [suggestion] = await db
    .update(aiTaskSuggestions)
    .set({ status, reviewedBy, reviewedAt: new Date() })
    .where(eq(aiTaskSuggestions.id, id))
    .returning();
  return suggestion;
}
