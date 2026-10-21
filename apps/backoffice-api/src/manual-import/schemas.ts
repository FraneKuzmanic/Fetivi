import {
  HOST_BLOCK_CATEGORIES,
  type HostBlockCategory,
  LIMITS,
  type ManualDraftItem,
  stripMarkdownHtml,
  wizardField,
} from '@fetivi/domain';
import { z } from 'zod';
import { AmenitiesBody, line } from '../properties/schemas';
import { fieldSchema } from './drafts';

/** Pasted text; the character limit is checked after normalisation, so this only bounds the body. */
export const PasteBody = z.strictObject({ text: z.string().max(LIMITS.manualText * 2) });

export const UnitParams = z.object({ id: z.uuid() });
export const ItemParams = z.object({ id: z.uuid(), itemId: z.string().regex(/^d\d{1,3}$/) });

const blockText = {
  title: line(LIMITS.title),
  body: z.string().transform(stripMarkdownHtml).pipe(z.string().min(1).max(LIMITS.blockBody)),
};

const BlockConfirm = z.strictObject(blockText);
const UnmappedConfirm = z.strictObject({
  category: z.enum(HOST_BLOCK_CATEGORIES as [HostBlockCategory, ...HostBlockCategory[]]),
  ...blockText,
});
const AmenitiesConfirm = z.strictObject({
  amenities: AmenitiesBody.shape.amenities.min(1),
});

/** The confirm body of a draft: what the host confirms, possibly edited, is what gets written. */
export function parseConfirm(item: ManualDraftItem, body: unknown) {
  switch (item.kind) {
    case 'field':
      return {
        kind: 'field' as const,
        values: z.strictObject({ values: fieldSchema(wizardField(item.fieldId)) }).parse(body)
          .values as Record<string, unknown>,
      };
    case 'amenities':
      return { kind: 'amenities' as const, ...AmenitiesConfirm.parse(body) };
    case 'block':
      return { kind: 'block' as const, ...BlockConfirm.parse(body) };
    case 'unmapped':
      return { kind: 'unmapped' as const, ...UnmappedConfirm.parse(body) };
  }
}
export type ConfirmInput = ReturnType<typeof parseConfirm>;
