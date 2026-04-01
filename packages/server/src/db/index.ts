import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

let db: ReturnType<typeof drizzle<typeof schema>>;
let sql: ReturnType<typeof postgres>;

export function initDb(databaseUrl?: string) {
  const url = databaseUrl || process.env.DATABASE_URL || 'postgresql://howinlens:howinlens@localhost:5432/howinlens';
  sql = postgres(url, { max: 20 });
  db = drizzle(sql, { schema });
  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export async function closeDb() {
  if (sql) await sql.end();
}

export type Database = ReturnType<typeof getDb>;
