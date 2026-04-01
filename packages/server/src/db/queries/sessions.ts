import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { sessions } from '../schema/index.js';

export async function createSession(params: {
  id: string;
  userId: number;
  model?: string;
  cwd?: string;
  source?: string;
  cliVersion?: string;
  modelProvider?: string;
  reasoningEffort?: string;
}) {
  const db = getDb();
  const [session] = await db.insert(sessions).values(params).returning();
  return session;
}

export async function getSessionById(id: string) {
  const db = getDb();
  const [session] = await db.select().from(sessions).where(eq(sessions.id, id));
  return session;
}

export async function getSessionsByUser(userId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.startedAt))
    .limit(limit);
}

export async function endSession(id: string, reason?: string) {
  const db = getDb();
  const [session] = await db
    .update(sessions)
    .set({
      endedAt: new Date(),
      endReason: reason,
    })
    .where(eq(sessions.id, id))
    .returning();
  return session;
}

export async function incrementSessionPromptCount(sessionId: string, creditCost: number) {
  const db = getDb();
  await db
    .update(sessions)
    .set({
      promptCount: sql`${sessions.promptCount} + 1`,
      totalCredits: sql`${sessions.totalCredits} + ${creditCost}`,
    })
    .where(eq(sessions.id, sessionId));
}

export async function updateSessionAI(
  sessionId: string,
  data: {
    aiSummary?: string;
    aiCategories?: string;
    aiProductivityScore?: number;
    aiKeyActions?: string;
    aiToolsSummary?: string;
  },
) {
  const db = getDb();
  const [session] = await db
    .update(sessions)
    .set({ ...data, aiAnalyzedAt: new Date() })
    .where(eq(sessions.id, sessionId))
    .returning();
  return session;
}

export async function getRecentSessions(limit = 50) {
  const db = getDb();
  return db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(limit);
}
