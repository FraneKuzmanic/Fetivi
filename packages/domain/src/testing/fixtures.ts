import { randomBytes } from 'node:crypto';
import { DateTime } from 'luxon';
import type { Db } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { infoBlocks } from '../db/schema/info-blocks';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import type { StayRow } from '../db/schema/stays';
import { blockTranslations } from '../db/schema/translations';
import { GUEST_LANGUAGES, type GuestLanguage } from '../property/vocabulary';
import { registerStay } from '../stays/store';
import { hashToken, newToken } from '../tokens';

export const TROGIR = { x: 16.2516, y: 43.5167 };
const ZONE = 'Europe/Zagreb';

export interface SeedGuestUnitOptions {
  /** The instant the Stay is registered at; dates are relative to it. Default: now. */
  now?: Date;
  /** Default Trogir; null = no location. */
  location?: { x: number; y: number } | null;
  unitName?: string;
  /** The unit's arrival release offset (0–7). Default 1. */
  releaseDaysBefore?: number;
  /** Days from `now` (in Zagreb) to check-in. Default 2. */
  checkInInDays?: number;
  nights?: number;
  spaceLanguage?: GuestLanguage;
}

export interface SeededGuestUnit {
  hostId: string;
  propertyId: string;
  unitId: string;
  unitName: string;
  stayId: string;
  stay: StayRow;
  spaceId: string;
  pin: string;
  /** Block ids: one always visible, one after_release. */
  blocks: { always: string; afterRelease: string };
  /** Unique per call so leak tests can search for them. */
  secrets: {
    buildingDoorCode: string;
    doorCode: string;
    lockboxCode: string;
    wifiPassword: string;
    hostPhone: string;
    emergencyContactPhone: string;
    accessInstructions: string;
  };
  /** Host-only values that never reach a guest. */
  private: { licenceNumber: string; qrSlug: string; bookerName: string; reservationNumber: string };
  /** Title text of the after_release block in each language, `[de] Arrival <hex>`. */
  afterReleaseTitle: (language: GuestLanguage) => string;
  alwaysTitle: (language: GuestLanguage) => string;
}

/**
 * An approved property in Europe/Zagreb with one live unit (every typed secret set), two
 * published blocks (one `after_release`) translated into all seven languages, a Stay and a Space.
 */
export async function seedGuestUnit(
  db: Db,
  options: SeedGuestUnitOptions = {},
): Promise<SeededGuestUnit> {
  const now = options.now ?? new Date();
  const tag = randomBytes(4).toString('hex');
  const unitName = options.unitName ?? `Apartment ${tag}`;
  const secrets = {
    buildingDoorCode: `B-${tag}-1`,
    doorCode: `D-${tag}-2`,
    lockboxCode: `L-${tag}-3`,
    wifiPassword: `W-${tag}-4`,
    hostPhone: `+385-${tag}-5`,
    emergencyContactPhone: `+385-${tag}-6`,
    accessInstructions: `Take the blue gate ${tag}`,
  };
  const priv = {
    licenceNumber: `LIC-${tag}`,
    qrSlug: `qr${tag}${randomBytes(2).toString('hex')}`,
    bookerName: `Booker ${tag}`,
    reservationNumber: `RES-${tag}`,
  };

  const [host] = await db
    .insert(accounts)
    .values({ email: `host-${tag}@example.test`, passwordHash: 'x', role: 'host' })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await db
    .insert(properties)
    .values({
      hostId: host.id,
      name: `Villa ${tag}`,
      timezone: ZONE,
      location: options.location === undefined ? TROGIR : options.location,
      approvedAt: now,
      buildingDoorCode: secrets.buildingDoorCode,
      hostPhone: secrets.hostPhone,
      emergencyContactName: 'Ana',
      emergencyContactPhone: secrets.emergencyContactPhone,
      licenceNumber: priv.licenceNumber,
      checkInTime: '15:00',
      checkoutTime: '10:00',
    })
    .returning();
  if (!property) throw new Error('no property');
  const [unit] = await db
    .insert(units)
    .values({
      propertyId: property.id,
      name: unitName,
      qrSlug: priv.qrSlug,
      wifiNetwork: `Net-${tag}`,
      wifiPassword: secrets.wifiPassword,
      doorCode: secrets.doorCode,
      lockboxCode: secrets.lockboxCode,
      accessInstructions: secrets.accessInstructions,
      arrivalReleaseDaysBefore: options.releaseDaysBefore ?? 1,
    })
    .returning();
  if (!unit) throw new Error('no unit');

  const alwaysTitle = (l: GuestLanguage) => `[${l}] Wifi tips ${tag}`;
  const afterReleaseTitle = (l: GuestLanguage) => `[${l}] Arrival ${tag}`;
  const [always, after] = await db
    .insert(infoBlocks)
    .values([
      {
        unitId: unit.id,
        category: 'wifi_essentials' as const,
        title: alwaysTitle('en'),
        body: 'Router in the hall.',
        visibility: 'always' as const,
        publishedRevision: 1,
        translationStatus: 'published' as const,
      },
      {
        unitId: unit.id,
        category: 'arrival_access' as const,
        title: afterReleaseTitle('en'),
        body: 'Key under the mat.',
        visibility: 'after_release' as const,
        publishedRevision: 1,
        translationStatus: 'published' as const,
      },
    ])
    .returning();
  if (!always || !after) throw new Error('no blocks');
  await db.insert(blockTranslations).values(
    GUEST_LANGUAGES.flatMap((language) => [
      {
        blockId: always.id,
        revision: 1,
        language,
        title: alwaysTitle(language),
        body: `[${language}] Router in the hall.`,
        origin: language === 'en' ? ('source' as const) : ('machine' as const),
      },
      {
        blockId: after.id,
        revision: 1,
        language,
        title: afterReleaseTitle(language),
        body: `[${language}] Key under the mat ${tag}.`,
        origin: language === 'en' ? ('source' as const) : ('machine' as const),
      },
    ]),
  );

  const today = DateTime.fromJSDate(now, { zone: ZONE }).startOf('day');
  const checkIn = today.plus({ days: options.checkInInDays ?? 2 });
  const stay = await registerStay(
    db,
    unit.id,
    {
      checkIn: checkIn.toISODate() as string,
      checkout: checkIn.plus({ days: options.nights ?? 3 }).toISODate() as string,
      partySize: 2,
      bookerName: priv.bookerName,
      reservationNumber: priv.reservationNumber,
    },
    now,
  );

  const [space] = await db
    .insert(spaces)
    .values({
      stayId: stay.id,
      tokenHash: hashToken(newToken()),
      language: options.spaceLanguage ?? 'en',
      closedAt: stay.activeUntil,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!space) throw new Error('no space');

  return {
    hostId: host.id,
    propertyId: property.id,
    unitId: unit.id,
    unitName,
    stayId: stay.id,
    stay,
    spaceId: space.id,
    pin: stay.pin,
    blocks: { always: always.id, afterRelease: after.id },
    secrets,
    private: priv,
    afterReleaseTitle,
    alwaysTitle,
  };
}
