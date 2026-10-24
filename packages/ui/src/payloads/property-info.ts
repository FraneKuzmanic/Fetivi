// The property info card: typed unit facts for one topic, built from the guest projection only,
// so the card in the Guide and the one in chat are the same and never carry model text.
import type { GuestProjection } from '@fetivi/domain/projection-types';
import { type BlockCategory, LIMITS, MEDIA_KINDS } from '@fetivi/domain/vocabulary';
import { z } from 'zod';

export const PROPERTY_INFO_TOPICS = ['arrival', 'wifi', 'checkout', 'contacts'] as const;
export type PropertyInfoTopic = (typeof PROPERTY_INFO_TOPICS)[number];

export const PROPERTY_INFO_FIELDS = [
  'checkInTime',
  'checkInMethod',
  'accessInstructions',
  'buildingDoorCode',
  'doorCode',
  'lockboxCode',
  'wifiNetwork',
  'wifiPassword',
  'checkoutTime',
  'quietHours',
  'pets',
  'smoking',
  'parties',
  'houseRulesNotes',
  'emergencyNumber',
  'hostPhone',
  'emergencyContactName',
  'emergencyContact',
] as const;
export type PropertyInfoField = (typeof PROPERTY_INFO_FIELDS)[number];

const field = z.object({
  key: z.enum(PROPERTY_INFO_FIELDS),
  /** Raw value; the app labels enums and booleans ('smart_lock', 'yes'/'no'). */
  value: z.string(),
  /** 'copy': a secret with a copy button; 'tel': a phone link, also copyable; 'text': plain. */
  action: z.enum(['text', 'copy', 'tel']),
});

export const propertyInfoCard = z.object({
  topic: z.enum(PROPERTY_INFO_TOPICS),
  /**
   * ISO instant when held-back details appear; null once released, when nothing is held back, or
   * for a topic with none.
   */
  releaseAt: z.string().nullable(),
  /** The property's zone, for showing `releaseAt`. */
  timezone: z.string(),
  fields: z.array(field).max(20),
  /** Media of the topic's Guide section blocks. */
  media: z
    .array(z.object({ id: z.string().min(1), kind: z.enum(MEDIA_KINDS), caption: z.string() }))
    .max(LIMITS.mediaPerBlock),
});

export type PropertyInfoPayload = z.infer<typeof propertyInfoCard>;
export type PropertyInfoFieldEntry = PropertyInfoPayload['fields'][number];

/** The Guide section each topic belongs to. */
export const TOPIC_CATEGORY: Record<PropertyInfoTopic, BlockCategory> = {
  arrival: 'arrival_access',
  wifi: 'wifi_essentials',
  checkout: 'house_rules_checkout',
  contacts: 'contacts_emergency',
};

/** Europe's emergency number, always shown. */
export const EMERGENCY_NUMBER = '112';

const yesNo = (value: boolean | null) => (value === null ? null : value ? 'yes' : 'no');
const hhmm = (time: string | null) => (time ? time.slice(0, 5) : null);

/** The card for one topic. Empty values are left out; gated values are null in the projection. */
export function propertyInfo(p: GuestProjection, topic: PropertyInfoTopic): PropertyInfoPayload {
  const fields: PropertyInfoFieldEntry[] = [];
  const add = (key: PropertyInfoField, value: string | null, action: 'text' | 'copy' | 'tel') => {
    if (value !== null && value.trim() !== '') fields.push({ key, value, action });
  };
  const gated = p.stay.arrivalDetailsPending ? p.stay.arrivalDetailsReleaseAt : null;
  let releaseAt: string | null = null;

  switch (topic) {
    case 'arrival':
      releaseAt = gated;
      add('checkInTime', hhmm(p.checkInOut.checkInTime), 'text');
      add('checkInMethod', p.checkInOut.checkInMethod, 'text');
      add('accessInstructions', p.arrival?.accessInstructions ?? null, 'text');
      add('buildingDoorCode', p.arrival?.buildingDoorCode ?? null, 'copy');
      add('doorCode', p.arrival?.doorCode ?? null, 'copy');
      add('lockboxCode', p.arrival?.lockboxCode ?? null, 'copy');
      break;
    case 'wifi':
      if (p.wifi) {
        releaseAt = gated;
        add('wifiNetwork', p.wifi.network, 'copy');
        add('wifiPassword', p.wifi.password, 'copy');
      }
      break;
    case 'checkout': {
      const { houseRules: r } = p;
      add('checkoutTime', hhmm(p.checkInOut.checkoutTime), 'text');
      const from = hhmm(r.quietHoursFrom);
      const to = hhmm(r.quietHoursTo);
      add('quietHours', from && to ? `${from}–${to}` : null, 'text');
      add('pets', yesNo(r.petsAllowed), 'text');
      add('smoking', yesNo(r.smokingAllowed), 'text');
      add('parties', yesNo(r.partiesAllowed), 'text');
      add('houseRulesNotes', r.notes, 'text');
      break;
    }
    case 'contacts':
      releaseAt = gated;
      fields.push(...contactFields(p.contacts));
      break;
  }

  const media = p.blocks
    .filter((b) => b.category === TOPIC_CATEGORY[topic])
    .flatMap((b) => b.media)
    .slice(0, LIMITS.mediaPerBlock);

  return { topic, releaseAt, timezone: p.property.timezone, fields, media };
}

export interface EmergencyContacts {
  hostPhone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

/** 112 first, then the host's phone and the emergency contact; empty values are left out. */
function contactFields(c: EmergencyContacts): PropertyInfoFieldEntry[] {
  const fields: PropertyInfoFieldEntry[] = [
    { key: 'emergencyNumber', value: EMERGENCY_NUMBER, action: 'tel' },
  ];
  const add = (key: PropertyInfoField, value: string | null, action: 'text' | 'tel') => {
    if (value !== null && value.trim() !== '') fields.push({ key, value, action });
  };
  add('hostPhone', c.hostPhone, 'tel');
  add('emergencyContactName', c.emergencyContactName, 'text');
  add('emergencyContact', c.emergencyContactPhone, 'tel');
  return fields;
}

/** The contacts card the emergency path shows in chat: the Guide's contacts, without media. */
export function contactsCard(
  c: EmergencyContacts & { releaseAt: string | null; timezone: string },
): PropertyInfoPayload {
  return {
    topic: 'contacts',
    releaseAt: c.releaseAt,
    timezone: c.timezone,
    fields: contactFields(c),
    media: [],
  };
}
