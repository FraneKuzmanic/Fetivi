import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ADAPTER_KINDS,
  AVAILABILITY_MODES,
  CONTACT_FIELDS,
  OFFER_CATEGORIES,
  ORDER_KINDS,
  PAYMENT_MODES,
  PRICE_UNITS,
  PROVIDER_LANGUAGES,
} from '../../offers/vocabulary';
import { PROVIDER_CARD_STATUSES } from '../../payments/vocabulary';
import { accounts } from './accounts';
import { catalogRecords, destinations } from './catalog';
import { sourceLanguage, translationError, translationStatus } from './info-blocks';
import { guestLanguage, translationOrigin } from './translations';

export const orderKind = pgEnum('order_kind', ORDER_KINDS);
export const offerCategory = pgEnum('offer_category', OFFER_CATEGORIES);
export const availabilityMode = pgEnum('availability_mode', AVAILABILITY_MODES);
export const paymentMode = pgEnum('payment_mode', PAYMENT_MODES);
export const contactFields = pgEnum('contact_fields', CONTACT_FIELDS);
export const priceUnit = pgEnum('price_unit', PRICE_UNITS);
export const adapterKind = pgEnum('adapter_kind', ADAPTER_KINDS);
export const providerLanguage = pgEnum('provider_language', PROVIDER_LANGUAGES);
export const providerCardStatus = pgEnum('provider_card_status', PROVIDER_CARD_STATUSES);

/** A local business the admin has a deal with. It gets each Order by email and has no login. */
export const providers = pgTable(
  'providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    email: text('email').notNull(),
    /** Stored for WhatsApp order links (ticket 48); email is used until then. */
    whatsappPhone: text('whatsapp_phone'),
    /** The language of the Provider's order emails and order page. */
    language: providerLanguage('language').notNull().default('hr'),
    taxNumber: text('tax_number'),
    /** The platform's commission in basis points (12.5 % = 1250). */
    commissionBp: integer('commission_bp').notNull().default(0),
    /** Free text, visible to the admin only. */
    dealNotes: text('deal_notes'),
    /** The Stripe connected account (Accounts v2, merchant), created by the admin's onboarding link. */
    stripeAccountId: text('stripe_account_id'),
    /** The account's card payments capability as last read from Stripe; null when never onboarded. */
    stripeCardPayments: providerCardStatus('stripe_card_payments'),
    stripeCheckedAt: timestamp('stripe_checked_at', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('providers_commission_check', sql`${t.commissionBp} between 0 and 10000`)],
);

/**
 * A service a Provider (or, from ticket 38, a host) makes available to guests. Exactly one owner;
 * a Provider Offer always has a destination. Owner and destination never change after create.
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'restrict' }),
    hostId: uuid('host_id').references(() => accounts.id, { onDelete: 'cascade' }),
    destinationId: uuid('destination_id').references(() => destinations.id, {
      onDelete: 'restrict',
    }),
    /** A catalog place in the same destination (checked by the store). */
    placeId: uuid('place_id').references(() => catalogRecords.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** Markdown, in the admin's source language. */
    description: text('description').notNull(),
    /** Markdown shown to guests; the refund rules below are what is applied. */
    cancellationPolicy: text('cancellation_policy').notNull(),
    category: offerCategory('category').notNull(),
    orderKind: orderKind('order_kind').notNull(),
    availabilityMode: availabilityMode('availability_mode').notNull(),
    paymentMode: paymentMode('payment_mode').notNull(),
    /** In cents; null only for request-kind Offers, where the Provider names the price. */
    priceMinor: integer('price_minor'),
    /** ISO 4217. */
    currency: text('currency').notNull().default('EUR'),
    priceUnit: priceUnit('price_unit').notNull().default('person'),
    /** Cancellation is free until this many hours before the start. */
    freeCancelHoursBefore: integer('free_cancel_hours_before').notNull().default(24),
    /** The percentage refunded after the free period. */
    refundPercentAfter: smallint('refund_percent_after').notNull().default(0),
    /** Minutes the Provider has to answer, counted only between the hours below. */
    responseWindowMinutes: integer('response_window_minutes').notNull().default(30),
    /** Wall-clock times in the destination's zone (the property's for host Offers). */
    responseHoursFrom: time('response_hours_from').notNull().default('08:00'),
    responseHoursTo: time('response_hours_to').notNull().default('21:00'),
    contactFields: contactFields('contact_fields').notNull().default('name'),
    /** Live mode only. */
    adapterKind: adapterKind('adapter_kind'),
    /** The product id in the adapter's system; live mode only. */
    externalProductRef: text('external_product_ref'),
    active: boolean('active').notNull().default(true),
    /** Source revision, +1 on every edit of title, description or policy text. */
    revision: integer('revision').notNull().default(1),
    /** The revision guests see; null until all seven languages first exist. */
    publishedRevision: integer('published_revision'),
    translationStatus: translationStatus('translation_status').notNull().default('pending'),
    translationError: translationError('translation_error'),
    sourceLanguage: sourceLanguage('source_language'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('offers_provider_idx').on(t.providerId),
    index('offers_host_idx').on(t.hostId),
    index('offers_destination_idx').on(t.destinationId),
    check('offers_owner_check', sql`(${t.providerId} is null) <> (${t.hostId} is null)`),
    check(
      'offers_destination_check',
      sql`${t.providerId} is null or ${t.destinationId} is not null`,
    ),
    check(
      'offers_price_check',
      // Spelled out per branch: a bare `between` on null is unknown, which a CHECK lets through.
      sql`(${t.priceMinor} is null and ${t.orderKind} = 'request') or (${t.priceMinor} is not null and ${t.priceMinor} between 0 and 10000000)`,
    ),
    check('offers_currency_check', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      'offers_request_check',
      sql`${t.orderKind} <> 'request' or ${t.availabilityMode} = 'on_request'`,
    ),
    check(
      'offers_live_check',
      sql`((${t.availabilityMode} = 'live') = (${t.adapterKind} is not null)) and (${t.availabilityMode} <> 'live' or ${t.externalProductRef} is not null)`,
    ),
    check(
      'offers_refund_check',
      sql`${t.freeCancelHoursBefore} between 0 and 720 and ${t.refundPercentAfter} between 0 and 100`,
    ),
    check(
      'offers_response_window_check',
      // Under 4 × the daily span: even a request just after closing is answered within 4 days
      // (maxResponseWindowMinutes in vocabulary.ts).
      sql`${t.responseWindowMinutes} >= 1 and ${t.responseHoursFrom} < ${t.responseHoursTo} and ${t.responseWindowMinutes} < 4 * extract(epoch from ${t.responseHoursTo} - ${t.responseHoursFrom}) / 60`,
    ),
    check(
      'offers_published_revision_check',
      sql`${t.publishedRevision} is null or ${t.publishedRevision} <= ${t.revision}`,
    ),
  ],
);

/** One guest language's title, description and policy text of an Offer, for one revision. */
export const offerTranslations = pgTable(
  'offer_translations',
  {
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    language: guestLanguage('language').notNull(),
    title: text('title').notNull(),
    /** Markdown: the description. */
    body: text('body').notNull(),
    /** Markdown. */
    cancellationPolicy: text('cancellation_policy').notNull(),
    origin: translationOrigin('origin').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.offerId, t.revision, t.language] })],
);

/** Seats from the deal for one start time of an allotment Offer. */
export const allotmentSlots = pgTable(
  'allotment_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    /** Seats not yet taken; ticket 15's allotment adapter decrements it. */
    remaining: integer('remaining').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('allotment_slots_offer_start_unique').on(t.offerId, t.startsAt),
    check(
      'allotment_slots_capacity_check',
      sql`${t.capacity} between 1 and 999 and ${t.remaining} between 0 and ${t.capacity}`,
    ),
  ],
);

export type ProviderRow = typeof providers.$inferSelect;
export type OfferRow = typeof offers.$inferSelect;
export type OfferTranslationRow = typeof offerTranslations.$inferSelect;
export type AllotmentSlotRow = typeof allotmentSlots.$inferSelect;
