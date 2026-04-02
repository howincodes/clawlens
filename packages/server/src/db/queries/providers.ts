import { eq } from 'drizzle-orm';
import { getDb } from '../index.js';
import { providers } from '../schema/index.js';

export async function getProviderBySlug(slug: string) {
  const db = getDb();
  const [provider] = await db.select().from(providers).where(eq(providers.slug, slug));
  return provider;
}

export async function getAllProviders() {
  const db = getDb();
  return db.select().from(providers);
}

export async function createProvider(params: {
  slug: string;
  name: string;
  type: string;
  enabled?: boolean;
  hasHooks?: boolean;
  hasBlocking?: boolean;
  hasCredentials?: boolean;
  hasUsagePolling?: boolean;
  hasLocalFiles?: boolean;
  hasEnforcedMode?: boolean;
  config?: string;
}) {
  const db = getDb();
  const [provider] = await db
    .insert(providers)
    .values(params)
    .onConflictDoNothing({ target: providers.slug })
    .returning();
  return provider;
}

export async function updateProvider(id: number, params: Partial<{
  name: string;
  enabled: boolean;
  config: string;
}>) {
  const db = getDb();
  const [provider] = await db
    .update(providers)
    .set(params)
    .where(eq(providers.id, id))
    .returning();
  return provider;
}

export async function isProviderEnabled(slug: string): Promise<boolean> {
  const provider = await getProviderBySlug(slug);
  return provider?.enabled ?? false;
}
