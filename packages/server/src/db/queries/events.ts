import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import { hookEvents, toolEvents, subagentEvents } from '../schema/index.js';

export async function recordHookEvent(params: {
  userId: number;
  sessionId?: string;
  eventType: string;
  payload?: string;
  source?: string;
}) {
  const db = getDb();
  const [event] = await db.insert(hookEvents).values(params).returning();
  return event;
}

export async function getHookEventsByUser(userId: number, limit = 100) {
  const db = getDb();
  return db
    .select()
    .from(hookEvents)
    .where(eq(hookEvents.userId, userId))
    .orderBy(desc(hookEvents.createdAt))
    .limit(limit);
}

export async function recordToolEvent(params: {
  userId: number;
  sessionId?: string;
  toolName: string;
  toolInput?: string;
  toolOutput?: string;
  success?: boolean;
  source?: string;
  toolUseId?: string;
}) {
  const db = getDb();
  const [event] = await db.insert(toolEvents).values(params).returning();
  return event;
}

export async function updateToolEventByToolUseId(
  toolUseId: string,
  source: string,
  updates: { toolOutput?: string; success?: boolean },
) {
  const db = getDb();
  const [event] = await db
    .update(toolEvents)
    .set(updates)
    .where(and(eq(toolEvents.toolUseId, toolUseId), eq(toolEvents.source, source)))
    .returning();
  return event;
}

export async function recordSubagentEvent(params: {
  userId: number;
  sessionId?: string;
  agentId?: string;
  agentType?: string;
}) {
  const db = getDb();
  const [event] = await db.insert(subagentEvents).values(params).returning();
  return event;
}
