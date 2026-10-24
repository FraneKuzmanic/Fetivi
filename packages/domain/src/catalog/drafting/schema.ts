import { z } from 'zod';

/** A drafted value and the exact url attribute of the page that states it, or null. */
const sourced = <T extends z.ZodType>(value: T) =>
  z.strictObject({ value, sourceUrl: z.string() }).nullable();

/**
 * The structured output of the one drafting call, kept flat. No length, range or pattern limits
 * here: structured outputs do not enforce them, so validate.ts does after the call.
 */
export const DraftExtraction = z.strictObject({
  title: sourced(z.string()),
  /** 2–4 sentences in English, facts from the pages only. */
  description: sourced(z.string()),
  address: sourced(z.string()),
  phone: sourced(z.string()),
  websiteUrl: sourced(z.string()),
  openingHours: sourced(
    z.array(
      z.strictObject({
        weekday: z.number().int(),
        opens: z.string(),
        closes: z.string(),
        validFrom: z.string().nullable(),
        validTo: z.string().nullable(),
      }),
    ),
  ),
  seasons: sourced(
    z.array(
      z.strictObject({
        fromMonth: z.number().int(),
        fromDay: z.number().int(),
        toMonth: z.number().int(),
        toDay: z.number().int(),
      }),
    ),
  ),
  permanentlyClosed: z.boolean(),
});
export type DraftExtractionData = z.infer<typeof DraftExtraction>;
