import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type Db } from '../db/client';
import { runMigrations } from '../db/migrate';

export const TEST_ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://fetivi:fetivi@127.0.0.1:5433/postgres';
export const TEMPLATE_DB = 'fetivi_test_template';

export interface TestDatabase {
  url: string;
  db: Db;
  pool: pg.Pool;
  drop(): Promise<void>;
}

function urlFor(dbName: string): string {
  const url = new URL(TEST_ADMIN_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function withAdmin<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_ADMIN_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Creates the template database and migrates it. Runs once per test run. */
export async function buildTemplateDatabase(): Promise<void> {
  await withAdmin(async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${TEMPLATE_DB}" WITH (FORCE)`);
    await client.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  });
  await runMigrations(urlFor(TEMPLATE_DB));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh database cloned from the migrated template, private to the calling test file. */
export async function createTestDatabase(): Promise<TestDatabase> {
  // Names are built only from fixed parts, never caller input, so quoting is safe.
  const name = `fetivi_test_${process.pid}_${randomBytes(4).toString('hex')}`;

  await withAdmin(async (client) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.query(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DB}"`);
        return;
      } catch (error) {
        // 55006: another file is cloning the template at the same moment.
        const busy = (error as { code?: string }).code === '55006';
        if (!busy || attempt >= 10) throw error;
        await sleep(100 + Math.random() * 200);
      }
    }
  });

  const url = urlFor(name);
  const { db, pool } = createDb(url);
  return {
    url,
    db,
    pool,
    async drop() {
      await pool.end();
      await withAdmin((client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    },
  };
}

/** Drops databases left behind by crashed runs. Keeps the template. */
export async function dropLeftoverTestDatabases(): Promise<void> {
  await withAdmin(async (client) => {
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'fetivi_test_%' AND datname <> $1`,
      [TEMPLATE_DB],
    );
    for (const { datname } of rows) {
      await client.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  });
}
