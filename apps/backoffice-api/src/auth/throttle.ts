import { type Db, loginAttempts } from '@fetivi/domain';
import { and, eq, gt, sql } from 'drizzle-orm';

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_EMAIL = 5;
export const MAX_PER_IP = 50;

export async function isThrottled(db: Db, email: string, ip: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const count = async (
    column: typeof loginAttempts.email | typeof loginAttempts.ip,
    value: string,
  ) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(and(eq(column, value), gt(loginAttempts.createdAt, since)));
    return row?.n ?? 0;
  };
  return (
    (await count(loginAttempts.email, email)) >= MAX_PER_EMAIL ||
    (await count(loginAttempts.ip, ip)) >= MAX_PER_IP
  );
}

export async function recordFailure(db: Db, email: string, ip: string, now: Date): Promise<void> {
  await db.insert(loginAttempts).values({ email, ip, createdAt: now });
}

export async function clearFailures(db: Db, email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
}
