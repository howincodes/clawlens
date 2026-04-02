import { eq, and, gte, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { users, messages } from '../schema/index.js';

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

export async function getUserCreditUsage(
  userId: number,
  window: 'daily' | 'hourly' | 'monthly',
  source?: string,
): Promise<number> {
  const db = getDb();
  const now = new Date();
  let since: Date;
  if (window === 'hourly') since = new Date(now.getTime() - 60 * 60 * 1000);
  else if (window === 'daily') since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  else since = new Date(now.getFullYear(), now.getMonth(), 1);

  const conditions = [eq(messages.userId, userId), gte(messages.timestamp, since)];
  if (source) conditions.push(eq(messages.provider, source));

  const result = await db
    .select({ total: sql<number>`coalesce(sum(${messages.creditCost}), 0)::real` })
    .from(messages)
    .where(and(...conditions));
  return result[0]?.total ?? 0;
}

export async function getUserModelCreditUsage(
  userId: number,
  model: string,
  window: 'daily' | 'hourly' | 'monthly',
): Promise<number> {
  const db = getDb();
  const now = new Date();
  let since: Date;
  if (window === 'hourly') since = new Date(now.getTime() - 60 * 60 * 1000);
  else if (window === 'daily') since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  else since = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await db
    .select({ total: sql<number>`coalesce(sum(${messages.creditCost}), 0)::real` })
    .from(messages)
    .where(
      and(
        eq(messages.userId, userId),
        eq(messages.model, model),
        gte(messages.timestamp, since),
      ),
    );
  return result[0]?.total ?? 0;
}
