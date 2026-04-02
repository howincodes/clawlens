import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { messages } from '../schema/index.js';

export async function recordMessage(params: {
  provider: string;
  sessionId?: string;
  userId: number;
  type: string; // 'user' | 'assistant'
  content?: string;
  model?: string;
  rawModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  creditCost?: number;
  cwd?: string;
  gitBranch?: string;
  projectId?: number;
  blocked?: boolean;
  blockReason?: string;
  sourceType: string; // 'hook' | 'jsonl' | 'extension' | 'collector'
  turnId?: string;
  timestamp?: Date;
}) {
  const db = getDb();
  const [record] = await db.insert(messages).values({
    ...params,
    timestamp: params.timestamp ?? new Date(),
  }).returning();
  return record;
}

export async function getMessagesBySession(sessionId: string) {
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.timestamp));
}

export async function getMessagesByUser(userId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.timestamp))
    .limit(limit);
}

export async function getUserMessageCount(userId: number): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.userId, userId));
  return result[0]?.count ?? 0;
}

export async function updateMessageResponse(messageId: number, content: string) {
  const db = getDb();
  const [record] = await db
    .update(messages)
    .set({ content })
    .where(eq(messages.id, messageId))
    .returning();
  return record;
}

/**
 * Update the model on the most recent user message for a session that has no paired assistant response yet.
 * Used by the CC /stop handler to stamp the model after response generation.
 */
export async function updateLastMessageModel(sessionId: string, model: string) {
  const db = getDb();
  const [latest] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        eq(messages.type, 'user'),
      ),
    )
    .orderBy(desc(messages.id))
    .limit(1);

  if (latest) {
    await db.update(messages).set({ model }).where(eq(messages.id, latest.id));
  }
}

/**
 * Update the most recent user message for a session+provider that has no paired assistant response,
 * stamping it with the response model and token counts. Then insert an assistant message.
 * Used by the Codex /stop handler.
 */
export async function updateLastMessageWithResponse(
  sessionId: string,
  provider: string,
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
  // Find the most recent user message for this session + provider
  const [latest] = await db
    .select({ id: messages.id, userId: messages.userId })
    .from(messages)
    .where(
      and(
        eq(messages.sessionId, sessionId),
        eq(messages.provider, provider),
        eq(messages.type, 'user'),
      ),
    )
    .orderBy(desc(messages.id))
    .limit(1);

  if (!latest) return undefined;

  // Update the user message with token counts
  await db
    .update(messages)
    .set({
      model: updates.model,
      inputTokens: updates.inputTokens,
      cachedTokens: updates.cachedTokens,
    })
    .where(eq(messages.id, latest.id));

  // Insert the assistant response as a separate message
  if (updates.response) {
    const [assistant] = await db.insert(messages).values({
      provider,
      sessionId,
      userId: latest.userId,
      type: 'assistant',
      content: updates.response,
      model: updates.model,
      outputTokens: updates.outputTokens,
      reasoningTokens: updates.reasoningTokens,
      sourceType: 'hook',
      timestamp: new Date(),
    }).returning();
    return assistant;
  }

  return undefined;
}

/**
 * Check if a message with exact content already exists for a given session.
 * Used for deduplication during antigravity sync.
 */
export async function messageExistsForSession(sessionId: string, content: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), eq(messages.content, content)))
    .limit(1);
  return !!existing;
}

/**
 * Insert a JSONL-sourced message with uuid-based deduplication.
 * ON CONFLICT (uuid) DO NOTHING — idempotent for watcher restarts.
 */
export async function upsertMessageByUuid(params: {
  uuid: string;
  parentUuid?: string;
  provider: string;
  sessionId?: string;
  userId: number;
  type: string;
  content?: string;
  model?: string;
  rawModel?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  creditCost?: number;
  cwd?: string;
  gitBranch?: string;
  sourceType: string;
  timestamp?: Date;
}) {
  const db = getDb();
  const result = await db.execute(sql`
    INSERT INTO messages (
      uuid, parent_uuid, provider, session_id, user_id, type, content,
      model, raw_model, input_tokens, output_tokens, cached_tokens,
      cache_creation_tokens, credit_cost, cwd, git_branch,
      source_type, timestamp, synced_at
    ) VALUES (
      ${params.uuid}, ${params.parentUuid ?? null}, ${params.provider},
      ${params.sessionId ?? null}, ${params.userId}, ${params.type},
      ${params.content ?? null}, ${params.model ?? null}, ${params.rawModel ?? null},
      ${params.inputTokens ?? null}, ${params.outputTokens ?? null},
      ${params.cachedTokens ?? null}, ${params.cacheCreationTokens ?? null},
      ${params.creditCost ?? 0}, ${params.cwd ?? null}, ${params.gitBranch ?? null},
      ${params.sourceType}, ${(params.timestamp ?? new Date()).toISOString()}, NOW()
    )
    ON CONFLICT (uuid) WHERE uuid IS NOT NULL DO NOTHING
  `);
  return result;
}
