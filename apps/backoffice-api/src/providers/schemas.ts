import {
  ADAPTER_KINDS,
  AVAILABILITY_MODES,
  CONTACT_FIELDS,
  LIMITS,
  maxResponseWindowMinutes,
  OFFER_CATEGORIES,
  OFFER_DEFAULTS,
  OFFER_LIMITS,
  ORDER_KINDS,
  PAYMENT_MODES,
  PRICE_UNITS,
  PROVIDER_DEFAULTS,
  PROVIDER_LANGUAGES,
} from '@fetivi/domain';
import { z } from 'zod';
import { Email } from '../auth/accounts';
import { civilDate, markdown } from '../catalog/schemas';
import { HHMM, line, optionalLine, optionalText, phone } from '../properties/schemas';

// Admin input for Providers, Offers and allotment slots. Strict objects: no body can set the
// Stripe account id, the owner after create, the revision or the translation status. The Offer
// create mirrors the database CHECKs so a bad combination is a clean 400 before the write; a
// patch leaves cross-field rules to the CHECKs, which also answer 400.

const providerFields = {
  name: line(LIMITS.name),
  email: Email,
  whatsappPhone: phone,
  /** The language of the Provider's order emails and order page. */
  language: z.enum(PROVIDER_LANGUAGES),
  taxNumber: optionalLine(OFFER_LIMITS.taxNumber),
  commissionBp: z.number().int().min(0).max(OFFER_LIMITS.commissionBpMax),
  dealNotes: optionalText(OFFER_LIMITS.dealNotes),
  active: z.boolean(),
};

export const ProviderCreate = z.strictObject({
  ...providerFields,
  whatsappPhone: providerFields.whatsappPhone.optional(),
  language: providerFields.language.default(PROVIDER_DEFAULTS.language),
  taxNumber: providerFields.taxNumber.optional(),
  commissionBp: providerFields.commissionBp.default(0),
  dealNotes: providerFields.dealNotes.optional(),
  active: providerFields.active.default(true),
});
export const ProviderPatch = z.strictObject(providerFields).partial();

const hhmm = z.string().regex(HHMM);

/** Offer fields without defaults; the create adds them. */
const offerFields = {
  placeId: z.uuid().nullable(),
  title: line(LIMITS.title),
  description: markdown,
  cancellationPolicy: markdown,
  category: z.enum(OFFER_CATEGORIES),
  orderKind: z.enum(ORDER_KINDS),
  availabilityMode: z.enum(AVAILABILITY_MODES),
  paymentMode: z.enum(PAYMENT_MODES),
  /** In cents. */
  priceMinor: z.number().int().min(0).max(OFFER_LIMITS.priceMinorMax).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  priceUnit: z.enum(PRICE_UNITS),
  freeCancelHoursBefore: z.number().int().min(0).max(OFFER_LIMITS.freeCancelHoursMax),
  refundPercentAfter: z.number().int().min(0).max(100),
  /** Capped by the hours below (maxResponseWindowMinutes); a PATCH meets the DB CHECK. */
  responseWindowMinutes: z.number().int().min(1),
  responseHoursFrom: hhmm,
  responseHoursTo: hhmm,
  contactFields: z.enum(CONTACT_FIELDS),
  adapterKind: z.enum(ADAPTER_KINDS).nullable(),
  externalProductRef: optionalLine(OFFER_LIMITS.externalRef),
  active: z.boolean(),
};

export const OfferCreate = z
  .strictObject({
    ...offerFields,
    destinationId: z.uuid(),
    placeId: offerFields.placeId.default(null),
    currency: offerFields.currency.default(OFFER_DEFAULTS.currency),
    priceUnit: offerFields.priceUnit.default(OFFER_DEFAULTS.priceUnit),
    freeCancelHoursBefore: offerFields.freeCancelHoursBefore.default(
      OFFER_DEFAULTS.freeCancelHoursBefore,
    ),
    refundPercentAfter: offerFields.refundPercentAfter.default(OFFER_DEFAULTS.refundPercentAfter),
    responseWindowMinutes: offerFields.responseWindowMinutes.default(
      OFFER_DEFAULTS.responseWindowMinutes,
    ),
    responseHoursFrom: hhmm.default(OFFER_DEFAULTS.responseHoursFrom),
    responseHoursTo: hhmm.default(OFFER_DEFAULTS.responseHoursTo),
    contactFields: offerFields.contactFields.default(OFFER_DEFAULTS.contactFields),
    adapterKind: offerFields.adapterKind.default(null),
    externalProductRef: offerFields.externalProductRef.default(null),
    active: offerFields.active.default(true),
  })
  .superRefine((o, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (o.priceMinor === null && o.orderKind !== 'request') fail('price required');
    if (o.orderKind === 'request' && o.availabilityMode !== 'on_request') {
      fail('requests are on request');
    }
    if ((o.availabilityMode === 'live') !== (o.adapterKind !== null)) fail('live needs an adapter');
    if (o.availabilityMode === 'live' && o.externalProductRef === null) fail('live needs a ref');
    if (o.responseHoursFrom >= o.responseHoursTo) fail('hours from must be before to');
    if (
      o.responseWindowMinutes > maxResponseWindowMinutes(o.responseHoursFrom, o.responseHoursTo)
    ) {
      fail('response window must end under 4 days');
    }
  });

export const OfferPatch = z.strictObject(offerFields).partial();

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

export const SlotsBulkBody = z
  .strictObject({
    from: civilDate,
    to: civilDate,
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    times: z.array(hhmm).min(1).max(OFFER_LIMITS.slotTimesPerDay),
    capacity: z.number().int().min(1).max(OFFER_LIMITS.capacityMax),
  })
  .refine((b) => b.from <= b.to)
  .refine((b) => daysBetween(b.from, b.to) < OFFER_LIMITS.slotRangeDays);

export const SlotPatch = z.strictObject({
  capacity: z.number().int().min(1).max(OFFER_LIMITS.capacityMax),
});

export const SlotsQuery = z.strictObject({ past: z.enum(['true', 'false']).optional() });
