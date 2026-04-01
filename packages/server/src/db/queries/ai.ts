import { eq, desc, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { summaries, userProfiles, teamPulses } from '../schema/index.js';

export async function createSummary(params: {
  userId?: number;
  sessionId?: string;
  period?: string;
  summary: string;
  categories?: string;
  topics?: string;
  riskLevel?: string;
}) {
  const db = getDb();
  const [record] = await db.insert(summaries).values(params).returning();
  return record;
}

export async function getSummaries(params?: { userId?: number; limit?: number }) {
  const db = getDb();
  const limit = params?.limit ?? 50;
  if (params?.userId !== undefined) {
    return db
      .select()
      .from(summaries)
      .where(eq(summaries.userId, params.userId))
      .orderBy(desc(summaries.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(summaries)
    .orderBy(desc(summaries.createdAt))
    .limit(limit);
}

export async function getUserProfile(userId: number) {
  const db = getDb();
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return profile;
}

export async function upsertUserProfile(params: {
  userId: number;
  profile: string;
  promptCountAtUpdate: number;
}) {
  const db = getDb();
  const [result] = await db
    .insert(userProfiles)
    .values({
      userId: params.userId,
      profile: params.profile,
      promptCountAtUpdate: params.promptCountAtUpdate,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        profile: params.profile,
        version: sql`${userProfiles.version} + 1`,
        promptCountAtUpdate: params.promptCountAtUpdate,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getAllUserProfiles() {
  const db = getDb();
  return db.select().from(userProfiles);
}

export async function createTeamPulse(pulse: string) {
  const db = getDb();
  const [record] = await db.insert(teamPulses).values({ pulse }).returning();
  return record;
}

export async function getLatestTeamPulse() {
  const db = getDb();
  const [pulse] = await db
    .select()
    .from(teamPulses)
    .orderBy(desc(teamPulses.generatedAt))
    .limit(1);
  return pulse;
}

export async function getTeamPulseHistory(limit = 10) {
  const db = getDb();
  return db
    .select()
    .from(teamPulses)
    .orderBy(desc(teamPulses.generatedAt))
    .limit(limit);
}
