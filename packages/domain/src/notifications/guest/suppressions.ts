import { eq } from 'drizzle-orm';
import type { Executor } from '../../db/client';
import { emailSuppressions } from '../../db/schema/notifications';

export type SuppressionReason = 'bounced' | 'complained';

/** Puts an address on the list (the Resend webhook); the first reason is kept. */
export async function suppressEmail(
  db: Executor,
  email: string,
  reason: SuppressionReason,
  now: Date,
): Promise<void> {
  await db
    .insert(emailSuppressions)
    .values({ email: email.trim().toLowerCase(), reason, createdAt: now })
    .onConflictDoNothing();
}

export async function isEmailSuppressed(db: Executor, email: string): Promise<boolean> {
  const [row] = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, email.trim().toLowerCase()));
  return row !== undefined;
}
