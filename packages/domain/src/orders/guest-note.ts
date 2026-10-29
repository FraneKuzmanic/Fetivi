import { and, eq, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { orders } from '../db/schema/orders';
import { spaces } from '../db/schema/spaces';
import type { HandoffTranslator } from '../handoff/translate';
import type { ProviderLanguage } from '../offers/vocabulary';

/** The longest guest note an Order takes. */
export const GUEST_NOTE_MAX = 500;

/** The note as stored: trimmed, with Unix line ends; null when nothing is left. */
export function cleanGuestNote(text: string | undefined | null): string | null {
  const cleaned = (text ?? '').replace(/\r\n?/g, '\n').trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * The Order's guest note with its translation into `to`, translating and storing it once. Runs
 * outside any transaction; a failed translation returns the original alone and stores nothing,
 * so the email still goes and a retry tries again.
 */
export async function ensureNoteTranslation(
  deps: { db: Executor; translator: HandoffTranslator },
  input: { orderId: string; to: ProviderLanguage },
): Promise<{ text: string; translation: string | null } | null> {
  const [row] = await deps.db
    .select({
      text: orders.guestNote,
      translation: orders.guestNoteTranslation,
      translatedTo: orders.guestNoteTranslatedTo,
      language: spaces.language,
    })
    .from(orders)
    .innerJoin(spaces, eq(spaces.id, orders.spaceId))
    .where(eq(orders.id, input.orderId));
  if (!row?.text) return null;
  const text = row.text;
  if (row.language === input.to) return { text, translation: null };
  if (row.translation && row.translatedTo === input.to) {
    return { text, translation: row.translation };
  }

  const result = await deps.translator.translate({ text, to: input.to });
  if (!result.ok) return { text, translation: null };
  await deps.db
    .update(orders)
    .set({ guestNoteTranslation: result.text, guestNoteTranslatedTo: input.to })
    .where(
      and(
        eq(orders.id, input.orderId),
        sql`${orders.guestNoteTranslatedTo} is distinct from ${input.to}`,
      ),
    );
  return { text, translation: result.text };
}
