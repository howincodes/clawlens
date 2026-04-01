import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import { projects, projectMembers } from '../schema/index.js';

export async function createProject(params: {
  name: string;
  description?: string;
  githubRepoUrl?: string;
  createdBy?: number;
}) {
  const db = getDb();
  const [project] = await db.insert(projects).values(params).returning();
  return project;
}

export async function getProjectById(id: number) {
  const db = getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  return project;
}

export async function getAllProjects() {
  const db = getDb();
  return db.select().from(projects).orderBy(desc(projects.createdAt));
}

export async function updateProject(
  id: number,
  params: Partial<{ name: string; description: string; githubRepoUrl: string; status: string }>,
) {
  const db = getDb();
  const [project] = await db
    .update(projects)
    .set({ ...params, updatedAt: new Date() })
    .where(eq(projects.id, id))
    .returning();
  return project;
}

export async function deleteProject(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(projects).where(eq(projects.id, id)).returning();
  return result.length > 0;
}

export async function getProjectMembers(projectId: number) {
  const db = getDb();
  return db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
}

export async function addProjectMember(params: {
  projectId: number;
  userId: number;
  roleId?: number;
  addedBy?: number;
}) {
  const db = getDb();
  const [member] = await db.insert(projectMembers).values(params).returning();
  return member;
}

export async function removeProjectMember(projectId: number, userId: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .returning();
  return result.length > 0;
}
