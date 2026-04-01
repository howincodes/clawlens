import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { prompts } from '../schema/index.js';

export async function recordPrompt(params: {
  sessionId?: string;
  userId: number;
  prompt?: string;
  response?: string;
  model?: string;
  creditCost?: number;
  blocked?: boolean;
  blockReason?: string;
  source?: string;
  turnId?: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}) {
  const db = getDb();
  const [record] = await db.insert(prompts).values(params).returning();
  return record;
}

export async function getPromptsBySession(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(prompts)
    .where(eq(prompts.sessionId, sessionId))
    .orderBy(desc(prompts.createdAt));
}

export async function getPromptsByUser(userId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(prompts)
    .where(eq(prompts.userId, userId))
    .orderBy(desc(prompts.createdAt))
    .limit(limit);
}

export async function getUserPromptCount(userId: number): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prompts)
    .where(eq(prompts.userId, userId));
  return result[0]?.count ?? 0;
}

export async function updatePromptResponse(promptId: number, response: string) {
  const db = getDb();
  const [record] = await db
    .update(prompts)
    .set({ response })
    .where(eq(prompts.id, promptId))
    .returning();
  return record;
}
