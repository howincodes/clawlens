import { eq, and, desc, sql } from 'drizzle-orm';
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

/**
 * Update the model on the most recent prompt for a session that has no response yet.
 * Used by the /stop hook to stamp the model after response generation.
 */
export async function updateLastPromptModel(sessionId: string, model: string) {
  const db = getDb();
  // Find the most recent prompt with no response for this session
  const [latest] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.sessionId, sessionId), sql`${prompts.response} IS NULL`))
    .orderBy(desc(prompts.id))
    .limit(1);

  if (latest) {
    await db.update(prompts).set({ model }).where(eq(prompts.id, latest.id));
  }
}

/**
 * Update the most recent prompt for a session (by source) that has no response yet,
 * stamping it with the response text, model, and token counts.
 * Used by the codex /stop handler.
 */
export async function updateLastPromptWithResponse(
  sessionId: string,
  source: string,
  updates: {
    response?: string;
    model?: string;
    inputTokens?: number;
    cachedTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  },
) {
  const db = getDb();
  // Find the most recent prompt with no response for this session + source
  const [latest] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(
      and(
        eq(prompts.sessionId, sessionId),
        eq(prompts.source, source),
        sql`${prompts.response} IS NULL`,
      ),
    )
    .orderBy(desc(prompts.id))
    .limit(1);

  if (latest) {
    const [updated] = await db
      .update(prompts)
      .set(updates)
      .where(eq(prompts.id, latest.id))
      .returning();
    return updated;
  }
  return undefined;
}

/**
 * Check if a prompt with exact content already exists for a given session.
 * Used for deduplication during antigravity sync.
 */
export async function promptExistsForSession(sessionId: string, promptText: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(and(eq(prompts.sessionId, sessionId), eq(prompts.prompt, promptText)))
    .limit(1);
  return !!existing;
}
