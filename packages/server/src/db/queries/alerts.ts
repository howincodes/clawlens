import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../index.js';
import { alerts, tamperAlerts } from '../schema/index.js';

export async function createAlert(params: {
  userId?: number;
  type: string;
  message: string;
}) {
  const db = getDb();
  const [alert] = await db.insert(alerts).values(params).returning();
  return alert;
}

export async function getUnresolvedAlerts() {
  const db = getDb();
  return db
    .select()
    .from(alerts)
    .where(eq(alerts.resolved, false))
    .orderBy(desc(alerts.createdAt));
}

export async function resolveAlert(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(alerts)
    .set({ resolved: true })
    .where(eq(alerts.id, id))
    .returning();
  return result.length > 0;
}

export async function createTamperAlert(params: {
  userId: number;
  alertType: string;
  details?: string;
}) {
  const db = getDb();
  const [alert] = await db.insert(tamperAlerts).values(params).returning();
  return alert;
}

export async function getUnresolvedTamperAlerts(userId?: number) {
  const db = getDb();
  const conditions = [eq(tamperAlerts.resolved, false)];
  if (userId !== undefined) {
    conditions.push(eq(tamperAlerts.userId, userId));
  }
  return db
    .select()
    .from(tamperAlerts)
    .where(and(...conditions))
    .orderBy(desc(tamperAlerts.createdAt));
}

export async function resolveTamperAlert(id: number): Promise<boolean> {
  const db = getDb();
  const result = await db
    .update(tamperAlerts)
    .set({ resolved: true, resolvedAt: new Date() })
    .where(eq(tamperAlerts.id, id))
    .returning();
  return result.length > 0;
}
