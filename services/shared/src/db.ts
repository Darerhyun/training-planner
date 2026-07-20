import { Pool, type PoolClient, type PoolConfig } from 'pg';

/**
 * Callable query interface kept stable so call sites stay unchanged:
 * `await getDb()(sqlText, params)` resolves to an array of row objects.
 */
export type SqlQuery = <T = Record<string, unknown>>(
  query: string,
  params?: unknown[],
) => Promise<T[]>;

export type TransactionHandler<T> = (query: SqlQuery) => Promise<T>;

let pool: Pool | undefined;
let query: SqlQuery | undefined;

/** Lazily builds the connection pool from DATABASE_URL. */
function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    // node-postgres parses the connection string for both connection styles:
    //  - Local dev via Cloud SQL Auth Proxy: postgresql://user:pass@localhost:5432/training_planner (TCP)
    //  - Cloud Run via Cloud SQL connector:  postgresql://user:pass@/training_planner?host=/cloudsql/PROJECT:REGION:INSTANCE (Unix socket)
    // No TLS config is set: the proxy/connector handle encryption.
    // max: 5 caps connections per pool (one pool per Cloud Run instance) so the
    // small Cloud SQL tier's connection limit isn't exhausted under scale-out.
    const config: PoolConfig = { connectionString: databaseUrl, max: 5 };
    pool = new Pool(config);
  }

  return pool;
}

/**
 * Returns a callable query function backed by a pooled pg connection.
 * Signature: `(sqlText, params?) => rows[]`.
 */
export function getDb(): SqlQuery {
  if (!query) {
    const activePool = getPool();
    query = async <T = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ): Promise<T[]> => {
      const result = await activePool.query(text, params);
      return result.rows as T[];
    };
  }

  return query;
}

function queryFromClient(client: PoolClient): SqlQuery {
  return async <T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]> => {
    const result = await client.query(text, params);
    return result.rows as T[];
  };
}

export async function withTransaction<T>(handler: TransactionHandler<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await handler(queryFromClient(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Lightweight connectivity check for readiness endpoints. */
export async function checkDbConnection(): Promise<boolean> {
  const result = await getDb()<{ ok: number }>('SELECT 1 AS ok');
  return result[0]?.ok === 1;
}
