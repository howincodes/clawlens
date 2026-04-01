import { eq, and, desc, gte } from 'drizzle-orm';
import { getDb } from '../index.js';
import {
  fileEvents,
  appTracking,
  projectDirectories,
  activityWindows,
} from '../schema/index.js';

// ---------------------------------------------------------------------------
// File Events
// ---------------------------------------------------------------------------

export async function recordFileEvents(
  events: Array<{
    userId: number;
    projectId?: number;
    filePath: string;
    eventType: string;
    sizeDelta?: number;
    timestamp?: Date;
  }>,
) {
  if (events.length === 0) return;
  const db = getDb();
  await db.insert(fileEvents).values(events);
}

export async function getFileEventsByUser(userId: number, since?: Date, limit = 50) {
  const db = getDb();
  const conditions = [eq(fileEvents.userId, userId)];
  if (since) conditions.push(gte(fileEvents.timestamp, since));
  return db
    .select()
    .from(fileEvents)
    .where(and(...conditions))
    .orderBy(desc(fileEvents.timestamp))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// App Tracking
// ---------------------------------------------------------------------------

export async function recordAppTracking(params: {
  userId: number;
  appName?: string;
  windowTitle?: string;
  startedAt: Date;
  durationSeconds?: number;
  date: string;
}) {
  const db = getDb();
  const [record] = await db.insert(appTracking).values(params).returning();
  return record;
}

export async function getAppTrackingByUser(userId: number, date?: string) {
  const db = getDb();
  const conditions = [eq(appTracking.userId, userId)];
  if (date) conditions.push(eq(appTracking.date, date));
  return db
    .select()
    .from(appTracking)
    .where(and(...conditions))
    .orderBy(desc(appTracking.startedAt));
}

// ---------------------------------------------------------------------------
// Project Directories
// ---------------------------------------------------------------------------

export async function linkProjectDirectory(params: {
  userId: number;
  projectId: number;
  localPath: string;
  discoveredVia?: string;
}) {
  const db = getDb();
  const [dir] = await db.insert(projectDirectories).values(params).returning();
  return dir;
}

export async function getProjectDirectories(userId: number) {
  const db = getDb();
  return db
    .select()
    .from(projectDirectories)
    .where(eq(projectDirectories.userId, userId));
}

export async function getProjectDirectoryByPath(userId: number, localPath: string) {
  const db = getDb();
  const [dir] = await db
    .select()
    .from(projectDirectories)
    .where(
      and(
        eq(projectDirectories.userId, userId),
        eq(projectDirectories.localPath, localPath),
      ),
    );
  return dir;
}

export async function unlinkProjectDirectory(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(projectDirectories)
    .where(eq(projectDirectories.id, id))
    .returning();
  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Activity Windows
// ---------------------------------------------------------------------------

export async function createActivityWindow(params: {
  userId: number;
  projectId?: number;
  date: string;
  windowStart: Date;
  windowEnd: Date;
  source?: string;
  eventCount?: number;
}) {
  const db = getDb();
  const [window] = await db.insert(activityWindows).values(params).returning();
  return window;
}

export async function getActivityWindows(userId: number, date?: string) {
  const db = getDb();
  const conditions = [eq(activityWindows.userId, userId)];
  if (date) conditions.push(eq(activityWindows.date, date));
  return db
    .select()
    .from(activityWindows)
    .where(and(...conditions))
    .orderBy(desc(activityWindows.windowStart));
}

export async function updateActivityWindowEnd(
  id: number,
  windowEnd: Date,
  eventCount: number,
) {
  const db = getDb();
  const [window] = await db
    .update(activityWindows)
    .set({ windowEnd, eventCount })
    .where(eq(activityWindows.id, id))
    .returning();
  return window;
}
