import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];

/** A database handle or an open transaction. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** The Postgres error code of a failed query, also when Drizzle wraps the driver error. */
export function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}
