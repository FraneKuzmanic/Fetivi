import { and, countDistinct, desc, eq, gt, inArray, isNull, lte, max, sql } from 'drizzle-orm';
import type { Db, Executor } from '../../db/client';
import { accounts } from '../../db/schema/accounts';
import { conversations, type MessagePart } from '../../db/schema/conversations';
import { properties, units } from '../../db/schema/properties';
import { spaces } from '../../db/schema/spaces';
import { stays } from '../../db/schema/stays';
import { contentGaps, hostSuggestions } from '../../db/schema/suggestions';
import { isFilled, type WizardFacts } from '../../property/completeness';
import { wizardFacts } from '../../property/go-live';
import { loadEffectiveUnit } from '../../property/load';
import { wizardStepPath } from '../../property/wizard-config';
import { suggestionText } from './copy';
import { gapTopics } from './gaps';
import { type GapTopic, gapTarget, MIN_GAP_STAYS } from './vocabulary';

/**
 * Records the property facts the turn's answers could not give, as topic codes per Stay (44
 * AC 1), and opens or bumps the unit's Suggestion once a topic went unanswered in at least two
 * Stays since its last resolution (AC 2). Runs inside appendTurn's transaction, which holds the
 * conversation lock. Two different Stays noting the same topic at the same moment may each count
 * one; the partial unique index keeps the upsert safe and the next gap corrects the count.
 */
export async function recordContentGaps(
  tx: Executor,
  conversationId: string,
  answers: { parts: MessagePart[] }[],
  now: Date,
): Promise<void> {
  const topics = [...new Set(answers.flatMap((a) => gapTopics(a.parts)))];
  if (!topics.length) return;
  const [stay] = await tx
    .select({ stayId: stays.id, unitId: stays.unitId })
    .from(conversations)
    .innerJoin(spaces, eq(spaces.id, conversations.spaceId))
    .innerJoin(stays, eq(stays.id, spaces.stayId))
    .where(eq(conversations.id, conversationId));
  // A gap never fails the turn.
  if (!stay) return;
  for (const topic of topics) {
    const [last] = await tx
      .select({ at: max(hostSuggestions.resolvedAt) })
      .from(hostSuggestions)
      .where(and(eq(hostSuggestions.unitId, stay.unitId), eq(hostSuggestions.topic, topic)));
    // A Stay whose gap predates the last resolution counts afresh: its row moves to now.
    const inserted = await tx
      .insert(contentGaps)
      .values({ stayId: stay.stayId, unitId: stay.unitId, topic, createdAt: now })
      .onConflictDoUpdate({
        target: [contentGaps.stayId, contentGaps.topic],
        set: { createdAt: now },
        setWhere: last?.at ? lte(contentGaps.createdAt, last.at) : sql`false`,
      })
      .returning({ id: contentGaps.id });
    // This Stay already counted for the topic (also a resumed turn re-reading its parts).
    if (!inserted.length) continue;
    const [counted] = await tx
      .select({ stays: countDistinct(contentGaps.stayId) })
      .from(contentGaps)
      .where(
        and(
          eq(contentGaps.unitId, stay.unitId),
          eq(contentGaps.topic, topic),
          last?.at ? gt(contentGaps.createdAt, last.at) : undefined,
        ),
      );
    const stayCount = counted?.stays ?? 0;
    if (stayCount < MIN_GAP_STAYS) continue;
    await tx
      .insert(hostSuggestions)
      .values({ unitId: stay.unitId, topic, stayCount, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [hostSuggestions.unitId, hostSuggestions.topic],
        targetWhere: sql`resolved_at is null`,
        set: { stayCount, updatedAt: now },
      });
  }
}

/** One open Suggestion as the host sees it: codes, counts and Fetivi's sentence, never guest text. */
export interface HostSuggestion {
  id: string;
  unitId: string;
  unitName: string;
  propertyName: string;
  topic: GapTopic;
  stayCount: number;
  text: string;
  wizardPath: string;
  createdAt: Date;
}

/**
 * The host's open Suggestions across all their units, newest first, in their back-office
 * language (44 AC 2, AC 3). A Suggestion whose wizard field is now filled on the effective unit
 * is resolved here and left out, so adding the data clears it on the next read.
 */
export async function listHostSuggestions(
  db: Db,
  hostId: string,
  now: Date,
): Promise<HostSuggestion[]> {
  const [account] = await db
    .select({ lang: accounts.uiLanguage })
    .from(accounts)
    .where(eq(accounts.id, hostId));
  const lang = account?.lang ?? 'en';
  const open = await db
    .select({
      id: hostSuggestions.id,
      unitId: hostSuggestions.unitId,
      unitName: units.name,
      propertyName: properties.name,
      topic: hostSuggestions.topic,
      stayCount: hostSuggestions.stayCount,
      createdAt: hostSuggestions.createdAt,
    })
    .from(hostSuggestions)
    .innerJoin(units, eq(units.id, hostSuggestions.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(properties.hostId, hostId), isNull(hostSuggestions.resolvedAt)))
    .orderBy(desc(hostSuggestions.updatedAt), desc(hostSuggestions.id));
  if (!open.length) return [];

  const facts = new Map<string, WizardFacts | null>();
  for (const unitId of new Set(open.map((s) => s.unitId))) {
    const effective = await loadEffectiveUnit(db, unitId);
    facts.set(unitId, effective ? wizardFacts(effective) : null);
  }
  const filled = open.filter((s) => {
    const f = facts.get(s.unitId);
    return f ? isFilled(s.topic, f) : false;
  });
  if (filled.length) {
    await db
      .update(hostSuggestions)
      .set({ resolvedAt: now, updatedAt: now })
      .where(
        and(
          inArray(
            hostSuggestions.id,
            filled.map((s) => s.id),
          ),
          isNull(hostSuggestions.resolvedAt),
        ),
      );
  }
  const resolved = new Set(filled.map((s) => s.id));
  return open
    .filter((s) => !resolved.has(s.id))
    .map((s) => {
      const { stepId, fieldId } = gapTarget(s.topic);
      return {
        ...s,
        text: suggestionText(lang, s.topic, s.stayCount),
        wizardPath: wizardStepPath(s.unitId, stepId, fieldId),
      };
    });
}
