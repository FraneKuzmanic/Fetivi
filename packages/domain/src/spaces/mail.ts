import { and, count, eq, gt } from 'drizzle-orm';
import type { Db, Executor } from '../db/client';
import { spaces, spaceTokens } from '../db/schema/spaces';
import { type JobQueue, QUEUES } from '../jobs/queue';
import type { Mailer } from '../mail';
import { GUEST_COPY } from '../notifications/guest/copy';
import { isEmailSuppressed } from '../notifications/guest/suppressions';
import { hashToken, newToken } from '../tokens';
import {
  SPACE_EMAIL_PATHS,
  SPACE_EMAILS_PER_HOUR,
  SPACE_READ_ONLY_DAYS,
  SPACE_RECOVERY_TTL_MS,
  SPACE_VERIFY_TTL_MS,
  type SpaceTokenPurpose,
} from './vocabulary';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Ids only: the token is made when the mail is sent, so pg-boss never stores a live link. */
export interface SpaceEmailJobData {
  purpose: SpaceTokenPurpose;
  spaceId: string;
}

/** Every request is a new mail; the send-time throttle bounds them. */
export async function enqueueSpaceEmail(
  tx: Executor,
  queue: JobQueue,
  data: SpaceEmailJobData,
): Promise<void> {
  await queue.send(QUEUES.spaceEmail, data, tx);
}

export interface SpaceEmailDeps {
  db: Db;
  mailer: Mailer;
  /** The guest app's origin, for the link. */
  guestOrigin: string;
  now: () => Date;
}

const TTL: Record<SpaceTokenPurpose, number> = {
  verify_email: SPACE_VERIFY_TTL_MS,
  recover: SPACE_RECOVERY_TTL_MS,
};

/**
 * Sends one verification or recovery mail for a Space, with a fresh single-use token. Skips when
 * the Space has no opted-in email, the address is suppressed, the mail is no longer needed, or
 * the hourly limit is reached. A retried job makes a second token, but the idempotency key keeps
 * it to one email.
 */
export async function sendSpaceEmail(
  deps: SpaceEmailDeps,
  data: SpaceEmailJobData,
  jobId: string,
): Promise<'sent' | 'skipped'> {
  const now = deps.now();
  const { purpose, spaceId } = data;
  const prepared = await deps.db.transaction(async (tx) => {
    const [space] = await tx
      .select({
        email: spaces.email,
        emailOptInAt: spaces.emailOptInAt,
        emailVerifiedAt: spaces.emailVerifiedAt,
        language: spaces.language,
        closedAt: spaces.closedAt,
      })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .for('update');
    if (!space?.email || !space.emailOptInAt) return null;
    if (purpose === 'verify_email' && space.emailVerifiedAt) return null;
    const readOnlyEnd = space.closedAt.getTime() + SPACE_READ_ONLY_DAYS * DAY_MS;
    if (purpose === 'recover' && now.getTime() >= readOnlyEnd) return null;
    if (await isEmailSuppressed(tx, space.email)) return null;

    const [recent] = await tx
      .select({ n: count() })
      .from(spaceTokens)
      .where(
        and(
          eq(spaceTokens.spaceId, spaceId),
          eq(spaceTokens.purpose, purpose),
          gt(spaceTokens.createdAt, new Date(now.getTime() - HOUR_MS)),
        ),
      );
    if ((recent?.n ?? 0) >= SPACE_EMAILS_PER_HOUR) return null;

    const token = newToken();
    await tx.insert(spaceTokens).values({
      tokenHash: hashToken(token),
      spaceId,
      purpose,
      email: space.email,
      createdAt: now,
      expiresAt: new Date(now.getTime() + TTL[purpose]),
    });
    return { email: space.email, language: space.language, token };
  });
  if (!prepared) return 'skipped';

  const copy = GUEST_COPY[prepared.language];
  const mail = copy.spaceEmails[purpose];
  const link = `${deps.guestOrigin}${SPACE_EMAIL_PATHS[purpose]}?token=${prepared.token}`;
  await deps.mailer.send({
    to: prepared.email,
    subject: mail.subject,
    text: [...mail.lines, '', `${mail.action}: ${link}`, '', copy.signature].join('\n'),
    idempotencyKey: `space-email:${jobId}`,
  });
  return 'sent';
}
