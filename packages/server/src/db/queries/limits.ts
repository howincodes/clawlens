import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { limits } from '../schema/index.js';

export async function createLimit(params: {
  userId: number;
  type: string;
  value: number;
  model?: string;
  window?: string;
  startHour?: number;
  endHour?: number;
  timezone?: string;
  source?: string;
}) {
  const db = getDb();
  const [limit] = await db.insert(limits).values(params).returning();
  return limit;
}

export async function getLimitsByUser(userId: number) {
  const db = getDb();
  return db.select().from(limits).where(eq(limits.userId, userId));
}

export async function deleteLimit(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db.delete(limits).where(eq(limits.id, id)).returning();
  return result.length > 0;
}

export async function deleteLimitsByUser(userId: number): Promise<number> {
  const db = getDb();
  const result = await db.delete(limits).where(eq(limits.userId, userId)).returning();
  return result.length;
}
