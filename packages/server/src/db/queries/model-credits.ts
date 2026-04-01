import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../index.js';
import { modelCredits, providerQuotas, modelAliases } from '../schema/index.js';

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

// ── Model Aliases ──

export async function getOrCreateModelAlias(rawName: string, displayName?: string, provider?: string, family?: string, tier?: string) {
  const db = getDb();
  const detected = detectModelInfo(rawName);

  await db.insert(modelAliases).values({
    rawName,
    displayName: displayName || detected.displayName,
    provider: provider || detected.provider,
    family: family || detected.family,
    tier: tier || detected.tier,
  }).onConflictDoNothing({ target: modelAliases.rawName });

  const [result] = await db.select().from(modelAliases).where(eq(modelAliases.rawName, rawName));
  return result;
}

export async function getAllModelAliases() {
  const db = getDb();
  return db.select().from(modelAliases).orderBy(modelAliases.provider, modelAliases.family);
}

export async function resolveModelName(rawName: string): Promise<string> {
  const db = getDb();
  const [alias] = await db.select().from(modelAliases).where(eq(modelAliases.rawName, rawName));
  return alias?.displayName || rawName;
}

function detectModelInfo(rawName: string): { displayName: string; provider: string; family: string; tier: string } {
  const lower = rawName.toLowerCase();

  // Anthropic models
  if (lower.includes('opus')) return { displayName: rawName.replace(/claude-/i, '').replace(/-\d+$/,''), provider: 'anthropic', family: 'opus', tier: 'flagship' };
  if (lower.includes('sonnet')) return { displayName: rawName.replace(/claude-/i, '').replace(/-\d+$/,''), provider: 'anthropic', family: 'sonnet', tier: 'mid' };
  if (lower.includes('haiku')) return { displayName: rawName.replace(/claude-/i, '').replace(/-\d+$/,''), provider: 'anthropic', family: 'haiku', tier: 'mini' };

  // OpenAI models
  if (lower.includes('gpt')) return { displayName: rawName, provider: 'openai', family: rawName.split('-').slice(0,2).join('-'), tier: lower.includes('mini') ? 'mini' : 'flagship' };

  // Google models
  if (lower.includes('gemini')) return { displayName: rawName, provider: 'google', family: 'gemini', tier: lower.includes('flash') ? 'mini' : 'flagship' };

  // Antigravity model placeholders
  if (lower.includes('model_placeholder')) return { displayName: rawName, provider: 'google', family: 'antigravity', tier: 'unknown' };

  return { displayName: rawName, provider: 'unknown', family: 'unknown', tier: 'unknown' };
}
