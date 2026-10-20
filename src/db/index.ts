import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import { getEnv } from '@/lib/env';

type DrizzleDb = ReturnType<typeof drizzleNeon<typeof schema>>;

let cachedDb: DrizzleDb | null = null;

export function getDb(): DrizzleDb {
  if (cachedDb) return cachedDb;

  const env = getEnv();
  const dbUrl = env.DATABASE_URL;

  const isNeonHost = dbUrl.includes('.neon.tech') || dbUrl.includes('neon.database');
  const isLocalHost = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');

  if (isNeonHost || (!isLocalHost && process.env.NODE_ENV === 'production')) {
    // Neon Serverless HTTP driver (ideal for Edge and Vercel serverless functions)
    const sql = neon(dbUrl);
    cachedDb = drizzleNeon(sql, { schema }) as unknown as DrizzleDb;
  } else {
    // Node.js PG client for local docker / standard PostgreSQL server
    const { Pool } = pg;
    const pool = new Pool({ connectionString: dbUrl });
    cachedDb = drizzlePg(pool, { schema }) as unknown as DrizzleDb;
  }

  return cachedDb;
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const activeDb = getDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (activeDb as any)[prop];
  },
});
