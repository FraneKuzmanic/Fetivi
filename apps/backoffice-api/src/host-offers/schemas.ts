import { z } from 'zod';
import { checkOfferCombination, offerCreateFields, offerFields } from '../providers/schemas';

// A host's own Offers (38): 06's fields minus the deal terms. No destination or place (a place
// needs a destination) and no live mode (a booking-engine deal, 37). The owner comes from the
// session, never the body.

const NOT_FOR_HOSTS = { placeId: true, adapterKind: true, externalProductRef: true } as const;

const HostAvailabilityMode = z.enum(['allotment', 'on_request']);

export const HostOfferCreate = z
  .strictObject({
    ...z.object(offerCreateFields).omit(NOT_FOR_HOSTS).shape,
    availabilityMode: HostAvailabilityMode,
  })
  .superRefine((o, ctx) =>
    checkOfferCombination(o, (message) => ctx.addIssue({ code: 'custom', message })),
  );

export const HostOfferPatch = z
  .strictObject({
    ...z.object(offerFields).omit(NOT_FOR_HOSTS).shape,
    availabilityMode: HostAvailabilityMode,
  })
  .partial();
