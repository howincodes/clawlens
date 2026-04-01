import { eq, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import { subscriptions } from '../schema/index.js';

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
