import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { Db } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { blockMedia } from '../db/schema/block-media';
import { catalogRecords, catalogTranslations, destinations } from '../db/schema/catalog';
import { infoBlocks } from '../db/schema/info-blocks';
import {
  allotmentSlots,
  offers,
  offerTranslations,
  type ProviderRow,
  providers,
} from '../db/schema/offers';
import { properties, units } from '../db/schema/properties';
import { spaces } from '../db/schema/spaces';
import type { StayRow } from '../db/schema/stays';
import { blockTranslations } from '../db/schema/translations';
import type { HandoffTranslation, HandoffTranslator } from '../handoff/translate';
import type { JobQueue } from '../jobs/queue';
import type {
  AvailabilityMode,
  ContactFields,
  OfferCategory,
  OrderKind,
  PaymentMode,
  PriceUnit,
  ProviderLanguage,
} from '../offers/vocabulary';
import {
  type BlockVisibility,
  GUEST_LANGUAGES,
  type GuestLanguage,
  type HostBlockCategory,
  MEDIA_TYPES,
  type MediaContentType,
} from '../property/vocabulary';
import { registerStay } from '../stays/store';
import { hashToken, newToken } from '../tokens';

export const TROGIR = { x: 16.2516, y: 43.5167 };
const ZONE = 'Europe/Zagreb';

/** A job queue that drops every job, for tests that write through the store without pg-boss. */
export const noopQueue: JobQueue = { send: async () => {}, publish: async () => {} };

export interface RecordedJob {
  name: string;
  data: object;
  id: string | undefined;
}

/**
 * A job queue that records sends and inserts nothing. Like pg-boss it ignores a second send
 * with the same id; unlike it, a send stays recorded when the caller's transaction rolls back.
 */
export function recordingQueue(): JobQueue & { readonly jobs: RecordedJob[] } {
  const jobs: RecordedJob[] = [];
  return {
    jobs,
    async send(name, data, _tx, options = {}) {
      if (options.id && jobs.some((j) => j.id === options.id)) return;
      jobs.push({ name, data, id: options.id });
    },
    async publish() {},
  };
}

/**
 * A handoff translator that answers from `outputs` in order (the last one repeats) and records
 * each call. A string is a successful translation; `null` is a model error.
 */
export function scriptedHandoffTranslator(
  outputs: (string | null)[],
): HandoffTranslator & { readonly calls: { text: string; to: GuestLanguage }[] } {
  const calls: { text: string; to: GuestLanguage }[] = [];
  return {
    calls,
    async translate(input): Promise<HandoffTranslation> {
      const out = outputs[Math.min(calls.length, outputs.length - 1)] ?? null;
      calls.push(input);
      return out === null
        ? { ok: false, error: 'model-error', detail: 'scripted failure' }
        : { ok: true, text: out };
    },
  };
}

/** Test-only: publishes every record as if its translation job had run. */
export async function publishCatalog(db: Db, destinationId: string): Promise<void> {
  const records = await db
    .select()
    .from(catalogRecords)
    .where(eq(catalogRecords.destinationId, destinationId));
  for (const record of records) {
    await db
      .insert(catalogTranslations)
      .values(
        GUEST_LANGUAGES.map((l) => ({
          recordId: record.id,
          revision: record.revision,
          language: l,
          title: `[${l}] ${record.title}`,
          body: `[${l}] ${record.description}`,
          origin: l === 'en' ? ('source' as const) : ('machine' as const),
        })),
      )
      .onConflictDoNothing();
    await db
      .update(catalogRecords)
      .set({ publishedRevision: record.revision, translationStatus: 'published' })
      .where(eq(catalogRecords.id, record.id));
  }
}

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
  /** More unit blocks, published at revision 1 in every language (`[<lang>] <text>`). */
  blocks?: SeedBlock[];
}

export interface SeedBlock {
  category: HostBlockCategory;
  title: string;
  body: string;
  visibility?: BlockVisibility;
  /** Each item's captions are `<lang>:<caption>`; the files themselves are not written. */
  media?: { caption: string; contentType: MediaContentType }[];
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
  /** The `blocks` option's blocks, in order, with their media ids. */
  extraBlocks: { id: string; media: string[] }[];
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

  const extraBlocks: SeededGuestUnit['extraBlocks'] = [];
  for (const [position, b] of (options.blocks ?? []).entries()) {
    const [row] = await db
      .insert(infoBlocks)
      .values({
        unitId: unit.id,
        category: b.category,
        title: b.title,
        body: b.body,
        visibility: b.visibility ?? 'always',
        position: position + 1,
        publishedRevision: 1,
        translationStatus: 'published',
      })
      .returning();
    if (!row) throw new Error('no block');
    const media = b.media?.length
      ? await db
          .insert(blockMedia)
          .values(
            b.media.map((m, i) => ({
              blockId: row.id,
              kind: MEDIA_TYPES[m.contentType].kind,
              contentType: m.contentType,
              bytes: 4,
              caption: m.caption,
              addedRevision: 1,
              position: i,
            })),
          )
          .returning()
      : [];
    await db.insert(blockTranslations).values(
      GUEST_LANGUAGES.map((language) => ({
        blockId: row.id,
        revision: 1,
        language,
        title: `[${language}] ${b.title}`,
        body: `[${language}] ${b.body}`,
        captions: Object.fromEntries(media.map((m) => [m.id, `${language}:${m.caption}`])),
        origin: language === 'en' ? ('source' as const) : ('machine' as const),
      })),
    );
    extraBlocks.push({ id: row.id, media: media.map((m) => m.id) });
  }

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
    extraBlocks,
  };
}

/** A Provider with a unique name and email. */
export async function seedProvider(
  db: Db,
  overrides: { language?: ProviderLanguage; commissionBp?: number } = {},
): Promise<ProviderRow> {
  const hex = randomBytes(4).toString('hex');
  const [provider] = await db
    .insert(providers)
    .values({ name: `Provider ${hex}`, email: `provider-${hex}@example.test`, ...overrides })
    .returning();
  if (!provider) throw new Error('no provider');
  return provider;
}

/** A destination with a unique name around Trogir. */
export async function seedDestination(db: Db): Promise<string> {
  const [destination] = await db
    .insert(destinations)
    .values({
      name: `Trogir ${randomBytes(4).toString('hex')}`,
      centre: TROGIR,
      radiusM: 15_000,
      timezone: ZONE,
    })
    .returning();
  if (!destination) throw new Error('no destination');
  return destination.id;
}

export interface SeedOrderableOfferOptions {
  /** Exactly one owner: a host or a Provider. */
  hostId?: string;
  providerId?: string;
  /** Provider Offers only; a fresh destination is seeded when omitted. */
  destinationId?: string;
  contactFields?: ContactFields;
  availabilityMode: AvailabilityMode;
  /** Allotment only: the slot's seats. Default 4. */
  capacity?: number;
  /** Allotment only (required there): the slot's start. */
  startsAt?: Date;
  /** Default 'booking'; 'request' implies no price and needs on_request. */
  orderKind?: OrderKind;
  paymentMode?: PaymentMode;
  priceUnit?: PriceUnit;
  /** In cents. Default 2500. */
  priceMinor?: number;
  /** A catalog place in the Offer's destination. */
  placeId?: string;
  /** Default 'tour'. */
  category?: OfferCategory;
  /** Default 'Kayak tour'. */
  title?: string;
}

/**
 * An Offer (no translation job) ready to be ordered, with one allotment slot for allotment Offers.
 * Host-owned unless `providerId` is given.
 */
export async function seedOrderableOffer(
  db: Db,
  options: SeedOrderableOfferOptions,
): Promise<{ offerId: string; slotId?: string }> {
  const { availabilityMode } = options;
  const orderKind = options.orderKind ?? 'booking';
  if (!options.hostId === !options.providerId) throw new Error('exactly one owner');
  const destinationId = options.providerId
    ? (options.destinationId ?? (await seedDestination(db)))
    : undefined;
  const [offer] = await db
    .insert(offers)
    .values({
      hostId: options.hostId,
      providerId: options.providerId,
      destinationId,
      contactFields: options.contactFields,
      placeId: options.placeId,
      title: options.title ?? 'Kayak tour',
      description: 'Around the islands.',
      cancellationPolicy: 'Free until 24 hours before.',
      category: options.category ?? 'tour',
      orderKind,
      availabilityMode,
      paymentMode: options.paymentMode ?? 'direct',
      priceMinor: orderKind === 'request' ? null : (options.priceMinor ?? 2500),
      priceUnit: options.priceUnit ?? 'person',
      adapterKind: availabilityMode === 'live' ? 'bokun' : null,
      externalProductRef:
        availabilityMode === 'live' ? `bokun-${randomBytes(3).toString('hex')}` : null,
    })
    .returning();
  if (!offer) throw new Error('no offer');
  if (availabilityMode !== 'allotment') return { offerId: offer.id };
  if (!options.startsAt) throw new Error('an allotment Offer needs startsAt');
  const capacity = options.capacity ?? 4;
  const [slot] = await db
    .insert(allotmentSlots)
    .values({ offerId: offer.id, startsAt: options.startsAt, capacity, remaining: capacity })
    .returning();
  if (!slot) throw new Error('no slot');
  return { offerId: offer.id, slotId: slot.id };
}

/** Test-only: publishes an Offer in every guest language as if its translation job had run. */
export async function publishOffer(db: Db, offerId: string): Promise<void> {
  const [offer] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!offer) throw new Error('no offer');
  await db
    .insert(offerTranslations)
    .values(
      GUEST_LANGUAGES.map((l) => ({
        offerId: offer.id,
        revision: offer.revision,
        language: l,
        title: `[${l}] ${offer.title}`,
        body: offer.description,
        cancellationPolicy: offer.cancellationPolicy,
        origin: l === 'en' ? ('source' as const) : ('machine' as const),
      })),
    )
    .onConflictDoNothing();
  await db
    .update(offers)
    .set({ publishedRevision: offer.revision, translationStatus: 'published' })
    .where(eq(offers.id, offer.id));
}
