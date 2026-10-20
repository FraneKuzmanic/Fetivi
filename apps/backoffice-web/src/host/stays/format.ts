import type { PropertySummary, Stay } from '../../api';

// Labels for Stays. Dates are civil dates, so they are formatted in UTC and never shift a day.
// Day first (en-GB): hosts in Croatia read 21 Oct, not Oct 21.

const civil = (date: string) => new Date(`${date}T00:00:00Z`);
const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "21 Oct – 24 Oct 2026", or with both years when the Stay crosses New Year. */
export function dateRange(checkIn: string, checkout: string): string {
  const sameYear = checkIn.slice(0, 4) === checkout.slice(0, 4);
  const from = (sameYear ? dayMonth : dayMonthYear).format(civil(checkIn));
  return `${from} – ${dayMonthYear.format(civil(checkout))}`;
}

export function nights(checkIn: string, checkout: string): number {
  return Math.round((civil(checkout).getTime() - civil(checkIn).getTime()) / 86_400_000);
}

export function nightsLabel(checkIn: string, checkout: string): string {
  const n = nights(checkIn, checkout);
  return n === 1 ? '1 night' : `${n} nights`;
}

export const PHASE_LABELS: Record<Stay['phase'], string> = {
  upcoming: 'Upcoming',
  in_stay: 'In stay',
  ended: 'Ended',
};

/** "Arrival details from 20 Oct, 00:00" for a local 'YYYY-MM-DDTHH:mm'. */
export function releaseText(arrivalReleaseLocal: string): string {
  const [date = '', time = ''] = arrivalReleaseLocal.split('T');
  return `Arrival details from ${dayMonth.format(civil(date))}, ${time}`;
}

/** Units that accept Stays: approved property, QR issued. */
export function liveUnits(properties: PropertySummary[]) {
  const several = properties.length > 1;
  return properties
    .filter((p) => p.approved)
    .flatMap((p) =>
      p.units
        .filter((u) => u.hasQr)
        .map((u) => ({ id: u.id, label: several ? `${p.name} · ${u.name}` : u.name })),
    );
}

export function guestsLabel(partySize: number): string {
  return partySize === 1 ? '1 guest' : `${partySize} guests`;
}
