import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { accounts, createDb, type Db } from '@fetivi/domain';
import { Email } from '../auth/accounts';
import { hashPassword, Password } from '../auth/passwords';
import { loadConfig } from '../config';

export type CreateAdminResult = { ok: true; id: string } | { ok: false; code: 'email-taken' };

/** Admins exist only through this command, never through sign-up. */
export async function createAdmin(
  db: Db,
  email: string,
  password: string,
): Promise<CreateAdminResult> {
  const [row] = await db
    .insert(accounts)
    .values({
      email: Email.parse(email),
      passwordHash: await hashPassword(Password.parse(password)),
      role: 'admin',
      emailVerifiedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: accounts.id });
  return row ? { ok: true, id: row.id } : { ok: false, code: 'email-taken' };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  if (!values.email) {
    console.error('Usage: pnpm admin:create --email <address>  (password from ADMIN_PASSWORD)');
    process.exitCode = 1;
    return;
  }
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');

  const { db, pool } = createDb(loadConfig().DATABASE_URL);
  try {
    const result = await createAdmin(db, values.email, password);
    if (!result.ok) {
      console.error(result.code);
      process.exitCode = 1;
      return;
    }
    console.log(`admin created: ${result.id}`);
    if (generated) console.log(`password (shown once): ${password}`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
