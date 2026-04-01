import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import { watcherCommands, watcherLogs } from '../schema/index.js';

export async function createWatcherCommand(params: {
  userId: number;
  command: string;
  payload?: string;
}) {
  const db = getDb();
  const [cmd] = await db.insert(watcherCommands).values(params).returning();
  return cmd;
}

export async function getPendingWatcherCommands(userId: number) {
  const db = getDb();
  return db
    .select()
    .from(watcherCommands)
    .where(
      and(
        eq(watcherCommands.userId, userId),
        eq(watcherCommands.status, 'pending'),
      ),
    )
    .orderBy(desc(watcherCommands.createdAt));
}

export async function markWatcherCommandDelivered(commandId: number) {
  const db = getDb();
  const [cmd] = await db
    .update(watcherCommands)
    .set({ status: 'delivered', completedAt: new Date() })
    .where(eq(watcherCommands.id, commandId))
    .returning();
  return cmd;
}

export async function saveWatcherLogs(params: {
  userId: number;
  hookLog?: string;
  watcherLog?: string;
}) {
  const db = getDb();
  const [log] = await db.insert(watcherLogs).values(params).returning();
  return log;
}

export async function getLatestWatcherLogs(userId: number) {
  const db = getDb();
  const [log] = await db
    .select()
    .from(watcherLogs)
    .where(eq(watcherLogs.userId, userId))
    .orderBy(desc(watcherLogs.uploadedAt))
    .limit(1);
  return log;
}
