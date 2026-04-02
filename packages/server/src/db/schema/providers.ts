import { pgTable, serial, varchar, boolean, text, timestamp } from 'drizzle-orm/pg-core';

export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 50 }).unique().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 20 }).notNull(), // 'hook' | 'extension' | 'collector'
  enabled: boolean('enabled').default(true),
  hasHooks: boolean('has_hooks').default(false),
  hasBlocking: boolean('has_blocking').default(false),
  hasCredentials: boolean('has_credentials').default(false),
  hasUsagePolling: boolean('has_usage_polling').default(false),
  hasLocalFiles: boolean('has_local_files').default(false),
  hasEnforcedMode: boolean('has_enforced_mode').default(false),
  config: text('config').default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
