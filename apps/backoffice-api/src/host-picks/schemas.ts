import { HOST_PLACE_LIMITS, PLACE_CATEGORIES, stripMarkup } from '@fetivi/domain';
import { z } from 'zod';
import { line, optionalLine, optionalText } from '../properties/schemas';

// Strict objects: a pick body can never carry a catalog field such as title or description (AC 5).

const location = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
/** A host-added place's note is required: it is why guests should go there. */
const note = z
  .string()
  .transform((s) => stripMarkup(s))
  .pipe(z.string().min(1).max(HOST_PLACE_LIMITS.note));

export const CatalogPlacesQuery = z.object({ q: z.string().trim().max(80).optional() });

export const HostPickCreate = z.strictObject({
  recordId: z.uuid(),
  note: optionalText(HOST_PLACE_LIMITS.note).default(null),
});

export const HostAddedPlaceCreate = z.strictObject({
  name: line(HOST_PLACE_LIMITS.name),
  placeCategory: z.enum(PLACE_CATEGORIES),
  location,
  address: optionalLine(HOST_PLACE_LIMITS.address).default(null),
  note,
});

/** On a pick the domain accepts only `note`; a null note clears a pick's note. */
export const HostPlacePatch = z
  .strictObject({
    note: optionalText(HOST_PLACE_LIMITS.note),
    name: line(HOST_PLACE_LIMITS.name),
    placeCategory: z.enum(PLACE_CATEGORIES),
    location,
    address: optionalLine(HOST_PLACE_LIMITS.address),
  })
  .partial();
