import { eq } from 'drizzle-orm';
import { getAboutMe } from '../about-me/store';
import type { Executor } from '../db/client';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import type { GuestIdentity } from '../situation/claims';
import { normalize } from './query';

/** A person's name also counts word by word: a query with only the surname still carries it. */
const nameWords = (name: string | null) =>
  (name ?? '').split(/\s+/).filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 4);

/**
 * Every value of this space the web fallback query must never carry: the stay's PIN, booker and
 * reservation number, the space's email, the unit's Wi-Fi and codes, the property's codes,
 * address, phones and emergency contact, and every saved About me code (as `code` and as words).
 * Normalized, 3+ characters, deduplicated. Never logged and never sent anywhere.
 */
export async function privateValuesOf(
  db: Executor,
  identity: Pick<GuestIdentity, 'spaceId' | 'stayId' | 'unitId' | 'propertyId'>,
): Promise<string[]> {
  const [[stay], [space], [unit], [property], aboutMe] = await Promise.all([
    db
      .select({
        pin: stays.pin,
        bookerName: stays.bookerName,
        reservation: stays.reservationNumber,
      })
      .from(stays)
      .where(eq(stays.id, identity.stayId)),
    db.select({ email: spaces.email }).from(spaces).where(eq(spaces.id, identity.spaceId)),
    db
      .select({
        wifiNetwork: units.wifiNetwork,
        wifiPassword: units.wifiPassword,
        doorCode: units.doorCode,
        lockboxCode: units.lockboxCode,
      })
      .from(units)
      .where(eq(units.id, identity.unitId)),
    db
      .select({
        buildingDoorCode: properties.buildingDoorCode,
        addressLine: properties.addressLine,
        hostPhone: properties.hostPhone,
        emergencyContactName: properties.emergencyContactName,
        emergencyContactPhone: properties.emergencyContactPhone,
      })
      .from(properties)
      .where(eq(properties.id, identity.propertyId)),
    getAboutMe(db, identity.spaceId),
  ]);
  const codes = [
    aboutMe.party,
    ...aboutMe.interests,
    aboutMe.pace,
    aboutMe.budget,
    ...aboutMe.needs,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  const raw = [
    stay?.pin,
    stay?.bookerName,
    ...nameWords(stay?.bookerName ?? null),
    stay?.reservation,
    space?.email,
    unit?.wifiNetwork,
    unit?.wifiPassword,
    unit?.doorCode,
    unit?.lockboxCode,
    property?.buildingDoorCode,
    property?.addressLine,
    property?.hostPhone,
    property?.emergencyContactName,
    ...nameWords(property?.emergencyContactName ?? null),
    property?.emergencyContactPhone,
    ...codes.flatMap((c) => [c, c.replaceAll('_', ' ')]),
  ];
  const values = new Set<string>();
  for (const value of raw) {
    const normalized = value ? normalize(value) : '';
    if (normalized.length >= 3) values.add(normalized);
  }
  return [...values];
}
