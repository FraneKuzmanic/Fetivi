import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../testing';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

describe('test database', () => {
  it('has postgis and pg_trgm', async () => {
    const result = await testDb.db.execute<{ extname: string }>(
      sql`select extname from pg_extension`,
    );
    const names = result.rows.map((r) => r.extname);
    expect(names).toContain('postgis');
    expect(names).toContain('pg_trgm');
  });

  it('computes the Trogir to Split distance with PostGIS (about 15.3 km)', async () => {
    const result = await testDb.db.execute<{ d: number }>(
      sql`select ST_Distance(ST_GeogFromText('POINT(16.2514 43.5170)'), ST_GeogFromText('POINT(16.4402 43.5081)')) as d`,
    );
    const d = Number(result.rows[0]?.d);
    expect(d).toBeGreaterThan(15_000);
    expect(d).toBeLessThan(16_000);
  });

  it('compares strings with pg_trgm', async () => {
    const result = await testDb.db.execute<{ s: number }>(
      sql`select similarity('Trogir', 'Trogirr') as s`,
    );
    expect(Number(result.rows[0]?.s)).toBeGreaterThan(0.5);
  });

  it('isolates one test database from another', async () => {
    const other = await createTestDatabase();
    try {
      await testDb.db.execute(sql`create table probe (id int)`);
      const result = await other.db.execute<{ t: string | null }>(
        sql`select to_regclass('public.probe') as t`,
      );
      expect(result.rows[0]?.t).toBeNull();
    } finally {
      await other.drop();
    }
  });

  it('applies every migration in the journal', async () => {
    const journalPath = fileURLToPath(new URL('../../drizzle/meta/_journal.json', import.meta.url));
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { entries: unknown[] };
    const result = await testDb.db.execute<{ n: number }>(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(result.rows[0]?.n).toBe(journal.entries.length);
  });
});
