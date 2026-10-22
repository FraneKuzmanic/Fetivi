import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import type { Mailer } from '../mail';
import { formatCivilDate } from '../notifications/provider/compose';
import { type StayNotifyJobData, stayDatesJobKey } from './store';

export interface StayNotifyDeps {
  db: Db;
  mailer: Mailer;
  now: () => Date;
  /** The back-office origin, for the link to the Stay. */
  webOrigin: string;
}

/**
 * Emails the host that a calendar moved a Stay, in English (the host UI's language). No PIN and
 * no booker name. A job whose dates no longer match the Stay was superseded and is skipped.
 */
export async function sendStayDatesChanged(
  deps: StayNotifyDeps,
  job: StayNotifyJobData,
): Promise<'sent' | 'skipped'> {
  const [row] = await deps.db
    .select({
      checkIn: stays.checkIn,
      checkout: stays.checkout,
      unitName: units.name,
      propertyName: properties.name,
      email: accounts.email,
    })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(accounts, eq(accounts.id, properties.hostId))
    .where(eq(stays.id, job.stayId));
  if (!row || row.checkIn !== job.checkIn || row.checkout !== job.checkout) return 'skipped';
  const range = `${formatCivilDate(row.checkIn, 'en')} – ${formatCivilDate(row.checkout, 'en')}`;
  await deps.mailer.send({
    to: row.email,
    subject: `Stay dates changed: ${row.unitName}, ${range}`,
    text: [
      `The calendar moved a Stay at ${row.propertyName}, ${row.unitName}.`,
      '',
      `New dates: ${range}`,
      '',
      'The PIN stays the same. If the guest already has it, there is nothing to resend.',
      '',
      `Open the Stay: ${deps.webOrigin}/stays/${job.stayId}`,
    ].join('\n'),
    idempotencyKey: stayDatesJobKey(job.stayId, job.checkIn, job.checkout),
  });
  return 'sent';
}
