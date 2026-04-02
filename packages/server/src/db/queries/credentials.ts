import { eq, and, desc, lte, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import {
  subscriptionCredentials,
  credentialAssignments,
  usageSnapshots,
  usagePolls,
  heartbeats,
  watchEvents,
  conversationMessages,
  sessionRawJsonl,
} from '../schema/index.js';

// ---------------------------------------------------------------------------
// Subscription Credentials
// ---------------------------------------------------------------------------

export async function createSubscriptionCredential(params: {
  email: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  orgId?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
}) {
  const db = getDb();
  const [credential] = await db.insert(subscriptionCredentials).values(params).returning();
  return credential;
}

export async function getAllSubscriptionCredentials() {
  const db = getDb();
  return db.select().from(subscriptionCredentials);
}

export async function getSubscriptionCredentialById(id: number) {
  const db = getDb();
  const [credential] = await db
    .select()
    .from(subscriptionCredentials)
    .where(eq(subscriptionCredentials.id, id));
  return credential;
}

export async function updateSubscriptionCredential(
  id: number,
  updates: Partial<typeof subscriptionCredentials.$inferInsert>,
) {
  const db = getDb();
  const [credential] = await db
    .update(subscriptionCredentials)
    .set(updates)
    .where(eq(subscriptionCredentials.id, id))
    .returning();
  return credential;
}

export async function deleteSubscriptionCredential(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(subscriptionCredentials)
    .where(eq(subscriptionCredentials.id, id))
    .returning();
  return result.length > 0;
}

export async function getActiveSubscriptionCredentials() {
  const db = getDb();
  return db
    .select()
    .from(subscriptionCredentials)
    .where(eq(subscriptionCredentials.isActive, true));
}

// ---------------------------------------------------------------------------
// Credential Assignments
// ---------------------------------------------------------------------------

export async function assignCredentialToUser(credentialId: number, userId: number) {
  const db = getDb();
  const [assignment] = await db
    .insert(credentialAssignments)
    .values({ credentialId, userId })
    .returning();
  return assignment;
}

export async function releaseCredentialFromUser(userId: number) {
  const db = getDb();
  const [assignment] = await db
    .update(credentialAssignments)
    .set({ status: 'released', releasedAt: new Date() })
    .where(
      and(
        eq(credentialAssignments.userId, userId),
        eq(credentialAssignments.status, 'active'),
      ),
    )
    .returning();
  return assignment;
}

export async function getActiveAssignment(userId: number) {
  const db = getDb();
  const [assignment] = await db
    .select()
    .from(credentialAssignments)
    .where(
      and(
        eq(credentialAssignments.userId, userId),
        eq(credentialAssignments.status, 'active'),
      ),
    );
  return assignment;
}

export async function getAssignmentsByCredential(credentialId: number) {
  const db = getDb();
  return db
    .select()
    .from(credentialAssignments)
    .where(eq(credentialAssignments.credentialId, credentialId))
    .orderBy(desc(credentialAssignments.assignedAt));
}

export async function getLeastUsedCredential() {
  const db = getDb();
  const result = await db.execute(sql`
    SELECT sc.id FROM subscription_credentials sc
    LEFT JOIN credential_assignments ca ON ca.credential_id = sc.id AND ca.status = 'active'
    WHERE sc.is_active = true
    GROUP BY sc.id
    ORDER BY COUNT(ca.id) ASC
    LIMIT 1
  `);
  const row = result[0] as { id: number } | undefined;
  if (!row) return undefined;
  return getSubscriptionCredentialById(row.id);
}

// ---------------------------------------------------------------------------
// Usage Snapshots
// ---------------------------------------------------------------------------

export async function recordUsageSnapshot(params: {
  credentialId: number;
  fiveHourUtilization?: number;
  sevenDayUtilization?: number;
  opusWeeklyUtilization?: number;
  sonnetWeeklyUtilization?: number;
  fiveHourResetsAt?: Date;
  sevenDayResetsAt?: Date;
}) {
  const db = getDb();
  const [snapshot] = await db.insert(usageSnapshots).values(params).returning();
  return snapshot;
}

export async function getLatestUsageSnapshot(credentialId: number) {
  const db = getDb();
  const [snapshot] = await db
    .select()
    .from(usageSnapshots)
    .where(eq(usageSnapshots.credentialId, credentialId))
    .orderBy(desc(usageSnapshots.recordedAt))
    .limit(1);
  return snapshot;
}

export async function getUsageSnapshots(credentialId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(usageSnapshots)
    .where(eq(usageSnapshots.credentialId, credentialId))
    .orderBy(desc(usageSnapshots.recordedAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Usage Polls (with user tracking)
// ---------------------------------------------------------------------------

export async function recordUsagePoll(params: {
  credentialId: number;
  fiveHourUtilization?: number;
  sevenDayUtilization?: number;
  opusWeeklyUtilization?: number;
  sonnetWeeklyUtilization?: number;
  fiveHourResetsAt?: Date;
  sevenDayResetsAt?: Date;
  assignedUserIds: string;
}) {
  const db = getDb();
  const [result] = await db.insert(usagePolls).values(params).returning();
  return result;
}

export async function getUsagePolls(credentialId: number, limit = 100) {
  const db = getDb();
  return db.select().from(usagePolls)
    .where(eq(usagePolls.credentialId, credentialId))
    .orderBy(desc(usagePolls.polledAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Heartbeats
// ---------------------------------------------------------------------------

export async function upsertHeartbeat(params: {
  userId: number;
  clientVersion?: string;
  platform?: string;
  watchStatus?: string;
  activeTaskId?: number;
}) {
  const db = getDb();
  const [result] = await db
    .insert(heartbeats)
    .values({
      userId: params.userId,
      clientVersion: params.clientVersion,
      platform: params.platform,
      watchStatus: params.watchStatus,
      activeTaskId: params.activeTaskId,
      lastPingAt: new Date(),
    })
    .onConflictDoUpdate({
      target: heartbeats.userId,
      set: {
        clientVersion: params.clientVersion,
        platform: params.platform,
        watchStatus: params.watchStatus,
        activeTaskId: params.activeTaskId,
        lastPingAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getHeartbeat(userId: number) {
  const db = getDb();
  const [heartbeat] = await db
    .select()
    .from(heartbeats)
    .where(eq(heartbeats.userId, userId));
  return heartbeat;
}

export async function getStaleHeartbeats(thresholdMinutes: number) {
  const db = getDb();
  const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
  return db.select().from(heartbeats).where(lte(heartbeats.lastPingAt, threshold));
}

// ---------------------------------------------------------------------------
// Watch Events
// ---------------------------------------------------------------------------

export async function recordWatchEvent(params: {
  userId: number;
  type: string;
  source?: string;
  latitude?: number;
  longitude?: number;
}) {
  const db = getDb();
  const [event] = await db.insert(watchEvents).values(params).returning();
  return event;
}

export async function getWatchEventsByUser(userId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(watchEvents)
    .where(eq(watchEvents.userId, userId))
    .orderBy(desc(watchEvents.timestamp))
    .limit(limit);
}

export async function getLatestWatchEvent(userId: number) {
  const db = getDb();
  const [event] = await db
    .select()
    .from(watchEvents)
    .where(eq(watchEvents.userId, userId))
    .orderBy(desc(watchEvents.timestamp))
    .limit(1);
  return event;
}

// ---------------------------------------------------------------------------
// Conversation Messages
// ---------------------------------------------------------------------------

export async function recordConversationMessages(
  messages: Array<{
    userId: number;
    sessionId?: string;
    type: string;
    messageContent?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cwd?: string;
    gitBranch?: string;
    timestamp?: Date;
  }>,
) {
  if (messages.length === 0) return;
  const db = getDb();
  await db.insert(conversationMessages).values(messages);
}

export async function getConversationsByUser(userId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.userId, userId))
    .orderBy(desc(conversationMessages.syncedAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Session Raw JSONL (full session replay)
// ---------------------------------------------------------------------------

export async function upsertSessionRawJsonl(params: {
  userId: number;
  sessionId: string;
  projectPath?: string;
  rawContent: string;
  lineCount?: number;
  lastOffset?: number;
}) {
  const db = getDb();
  const [result] = await db
    .insert(sessionRawJsonl)
    .values(params)
    .onConflictDoUpdate({
      target: [sessionRawJsonl.userId, sessionRawJsonl.sessionId],
      set: {
        rawContent: params.rawContent,
        lineCount: params.lineCount,
        lastOffset: params.lastOffset,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getSessionRawJsonl(userId: number, sessionId: string) {
  const db = getDb();
  const [result] = await db
    .select()
    .from(sessionRawJsonl)
    .where(and(eq(sessionRawJsonl.userId, userId), eq(sessionRawJsonl.sessionId, sessionId)));
  return result;
}

export async function getSessionRawJsonlByUser(userId: number, limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(sessionRawJsonl)
    .where(eq(sessionRawJsonl.userId, userId))
    .orderBy(desc(sessionRawJsonl.updatedAt))
    .limit(limit);
}
