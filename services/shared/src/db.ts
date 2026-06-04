import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let sql: NeonQueryFunction<false, false>;

/** Returns a Neon serverless SQL client using DATABASE_URL. */
export function getDb(): NeonQueryFunction<false, false> {
  if (!sql) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    sql = neon(databaseUrl);
  }
  return sql;
}

/** Lightweight connectivity check for readiness endpoints. */
export async function checkDbConnection(): Promise<boolean> {
  const result = await getDb()('SELECT 1 AS ok');
  return result[0]?.ok === 1;
}
