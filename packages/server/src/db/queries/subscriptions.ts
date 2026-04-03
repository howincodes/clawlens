import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import { subscriptions } from '../schema/index.js';

/**
 * Create or update a subscription by email+source.
 * Deduplicates: if a record with the same email+source exists, updates it.
 */
export async function createSubscription(params: {
  email: string;
  subscriptionType?: string;
  planName?: string;
  source?: string;
  accountId?: string;
  orgId?: string;
  authProvider?: string;
  subscriptionActiveStart?: string;
  subscriptionActiveUntil?: string;
}) {
  const db = getDb();

  // Check for existing subscription with same email + source
  if (params.email && params.source) {
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(and(
        eq(subscriptions.email, params.email),
        eq(subscriptions.source, params.source),
      ))
      .limit(1);

    if (existing) {
      // Update existing — refresh subscription type and metadata
      const updates: Record<string, any> = {};
      if (params.subscriptionType) updates.subscriptionType = params.subscriptionType;
      if (params.planName) updates.planName = params.planName;
      if (params.orgId) updates.orgId = params.orgId;
      if (params.accountId) updates.accountId = params.accountId;

      if (Object.keys(updates).length > 0) {
        const [updated] = await db
          .update(subscriptions)
          .set(updates)
          .where(eq(subscriptions.id, existing.id))
          .returning();
        return updated;
      }
      return existing;
    }
  }

  const [sub] = await db.insert(subscriptions).values(params).returning();
  return sub;
}

export async function getSubscriptions(source?: string) {
  const db = getDb();
  if (source) {
    return db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.source, source))
      .orderBy(desc(subscriptions.createdAt));
  }
  return db.select().from(subscriptions).orderBy(desc(subscriptions.createdAt));
}

export async function getSubscriptionByEmail(email: string) {
  const db = getDb();
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.email, email));
  return sub;
}

export async function deleteSubscription(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(subscriptions)
    .where(eq(subscriptions.id, id))
    .returning();
  return result.length > 0;
}
