import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { modelCredits, providerQuotas } from '../schema/index.js';

export async function getCreditCostFromDb(model: string, source: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(modelCredits)
    .where(and(eq(modelCredits.model, model), eq(modelCredits.source, source)));
  return row?.credits ?? 7;
}

export async function getModelCredits(source?: string) {
  const db = getDb();
  if (source) {
    return db
      .select()
      .from(modelCredits)
      .where(eq(modelCredits.source, source));
  }
  return db.select().from(modelCredits);
}

export async function upsertModelCredit(source: string, model: string, credits: number, tier?: string) {
  const db = getDb();
  const [result] = await db
    .insert(modelCredits)
    .values({ source, model, credits, tier })
    .onConflictDoUpdate({
      target: [modelCredits.source, modelCredits.model],
      set: { credits, tier },
    })
    .returning();
  return result;
}

export async function upsertProviderQuota(params: {
  userId: number;
  source: string;
  windowName: string;
  planType?: string;
  usedPercent?: number;
  windowMinutes?: number;
  resetsAt?: number;
}) {
  const db = getDb();
  const [result] = await db
    .insert(providerQuotas)
    .values({ ...params, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [providerQuotas.userId, providerQuotas.source, providerQuotas.windowName],
      set: {
        planType: params.planType,
        usedPercent: params.usedPercent,
        windowMinutes: params.windowMinutes,
        resetsAt: params.resetsAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getProviderQuotas(userId: number, source?: string) {
  const db = getDb();
  if (source) {
    return db
      .select()
      .from(providerQuotas)
      .where(
        and(eq(providerQuotas.userId, userId), eq(providerQuotas.source, source)),
      )
      .orderBy(desc(providerQuotas.updatedAt));
  }
  return db
    .select()
    .from(providerQuotas)
    .where(eq(providerQuotas.userId, userId))
    .orderBy(desc(providerQuotas.updatedAt));
}
