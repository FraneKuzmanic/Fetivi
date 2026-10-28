import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import type { Mailer } from '../mail';
import { HOST_COPY } from '../notifications/host/copy';
import { formatCivilDate } from '../notifications/provider/compose';
import { backofficeLanguageOf } from '../property/vocabulary';
import { type StayNotifyJobData, stayDatesJobKey } from './store';

export interface StayNotifyDeps {
  db: Db;
  mailer: Mailer;
  now: () => Date;
  /** The back-office origin, for the link to the Stay. */
  webOrigin: string;
}

/**
 * Emails the host that a calendar moved a Stay, in the host's back-office language. No PIN and
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
      uiLanguage: accounts.uiLanguage,
    })
    .from(stays)
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(accounts, eq(accounts.id, properties.hostId))
    .where(eq(stays.id, job.stayId));
  if (!row || row.checkIn !== job.checkIn || row.checkout !== job.checkout) return 'skipped';
  const language = backofficeLanguageOf(row.uiLanguage);
  const copy = HOST_COPY[language].stayDates;
  const range = `${formatCivilDate(row.checkIn, language)} – ${formatCivilDate(row.checkout, language)}`;
  await deps.mailer.send({
    to: row.email,
    subject: copy.subject(row.unitName, range),
    text: [
      copy.moved(row.propertyName, row.unitName),
      '',
      `${copy.newDates}: ${range}`,
      '',
      copy.pinSame,
      '',
      copy.open(`${deps.webOrigin}/stays/${job.stayId}`),
    ].join('\n'),
    idempotencyKey: stayDatesJobKey(job.stayId, job.checkIn, job.checkout),
  });
  return 'sent';
}
