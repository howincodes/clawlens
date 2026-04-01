import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { users } from '../schema/index.js';

export async function createUser(params: {
  name: string;
  email: string;
  passwordHash?: string;
  authToken: string;
  defaultModel?: string;
  githubId?: string;
  deploymentTier?: string;
}) {
  const db = getDb();
  const [user] = await db.insert(users).values(params).returning();
  return user;
}

export async function getUserById(id: number) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function getUserByEmail(email: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}

export async function getUserByToken(token: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.authToken, token));
  return user;
}

export async function getAllUsers() {
  const db = getDb();
  return db.select().from(users);
}

export async function updateUser(id: number, updates: Partial<typeof users.$inferInsert>) {
  const db = getDb();
  const [user] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
  return user;
}

export async function deleteUser(id: number) {
  const db = getDb();
  const result = await db.delete(users).where(eq(users.id, id)).returning();
  return result.length > 0;
}

export async function touchUserLastEvent(id: number) {
  const db = getDb();
  await db.update(users).set({ lastEventAt: new Date() }).where(eq(users.id, id));
}
