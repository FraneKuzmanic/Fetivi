import { and, desc, eq, lte, type SQL, sql } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { answerFeedback } from '../db/schema/feedback';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import { toLocalDateTime } from '../time';
import { type AnswerTopic, STATS_STAY_LIMIT, TOP_TOPICS_LIMIT } from './vocabulary';

// Aggregates only: these queries join answer_feedback, stays, units, properties and accounts,
// never messages or conversations, so no transcript can reach a host (43 AC 3; PRD §6.5).

export interface AnswerTotals {
  conversations: number;
  answers: number;
  up: number;
  down: number;
  wrong: number;
  outdated: number;
  notHelpful: number;
}
export interface TopicCount {
  topic: AnswerTopic;
  count: number;
}
export interface StayAnswerStats {
  stayId: string;
  checkIn: string;
  checkout: string;
  bookerName: string | null;
  conversations: number;
  answers: number;
  up: number;
  down: number;
}
export interface UnitAnswerStats {
  totals: AnswerTotals;
  topTopics: TopicCount[];
  stays: StayAnswerStats[];
}
export interface UnitAnswerRow extends AnswerTotals {
  unitId: string;
  unitName: string;
  propertyName: string;
  hostEmail: string;
  stays: number;
}
export interface AdminAnswerStats {
  totals: AnswerTotals;
  topTopics: TopicCount[];
  units: UnitAnswerRow[];
}

const n = (expr: SQL) => sql<number>`${expr}`.mapWith(Number);
const totalsColumns = () => ({
  conversations: n(sql`count(distinct ${answerFeedback.conversationId})`),
  answers: n(sql`count(*)`),
  up: n(sql`count(*) filter (where ${answerFeedback.thumb} = 'up')`),
  down: n(sql`count(*) filter (where ${answerFeedback.thumb} = 'down')`),
  wrong: n(sql`count(*) filter (where ${answerFeedback.reason} = 'wrong')`),
  outdated: n(sql`count(*) filter (where ${answerFeedback.reason} = 'outdated')`),
  notHelpful: n(sql`count(*) filter (where ${answerFeedback.reason} = 'not_helpful')`),
});

const ZERO: AnswerTotals = {
  conversations: 0,
  answers: 0,
  up: 0,
  down: 0,
  wrong: 0,
  outdated: 0,
  notHelpful: 0,
};

async function topTopics(db: Executor, unitId: string | null): Promise<TopicCount[]> {
  const where = unitId === null ? sql`` : sql`where ${stays.unitId} = ${unitId}`;
  const result = await db.execute<{ topic: AnswerTopic; count: number }>(sql`
    select t.topic::text as topic, count(*)::int as count
    from ${answerFeedback}
    join ${stays} on ${stays.id} = ${answerFeedback.stayId}
    cross join lateral unnest(${answerFeedback.topics}) as t(topic)
    ${where}
    group by t.topic
    order by count(*) desc, t.topic::text asc
    limit ${TOP_TOPICS_LIMIT}`);
  return result.rows.map((r) => ({ topic: r.topic, count: Number(r.count) }));
}

/**
 * One unit's answer stats (43 AC 3): totals, top topics and the Stays that have started (check-in
 * on or before today in the property's zone), newest first, with zeros for Stays without
 * conversations. The caller checks the unit is the host's.
 */
export async function unitAnswerStats(
  db: Executor,
  unitId: string,
  now: Date,
): Promise<UnitAnswerStats> {
  const [totals] = await db
    .select(totalsColumns())
    .from(answerFeedback)
    .innerJoin(stays, eq(stays.id, answerFeedback.stayId))
    .where(eq(stays.unitId, unitId));

  const [zone] = await db
    .select({ timezone: properties.timezone })
    .from(units)
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(eq(units.id, unitId));
  const today = zone ? toLocalDateTime(now, zone.timezone).slice(0, 10) : null;

  let stayRows: StayAnswerStats[] = [];
  if (today !== null) {
    const perStay = db
      .select({
        stayId: answerFeedback.stayId,
        conversations: sql<number>`count(distinct ${answerFeedback.conversationId})`.as(
          'conversations',
        ),
        answers: sql<number>`count(*)`.as('answers'),
        up: sql<number>`count(*) filter (where ${answerFeedback.thumb} = 'up')`.as('up'),
        down: sql<number>`count(*) filter (where ${answerFeedback.thumb} = 'down')`.as('down'),
      })
      .from(answerFeedback)
      .groupBy(answerFeedback.stayId)
      .as('per_stay');
    stayRows = await db
      .select({
        stayId: stays.id,
        checkIn: stays.checkIn,
        checkout: stays.checkout,
        bookerName: stays.bookerName,
        conversations: n(sql`coalesce(${perStay.conversations}, 0)`),
        answers: n(sql`coalesce(${perStay.answers}, 0)`),
        up: n(sql`coalesce(${perStay.up}, 0)`),
        down: n(sql`coalesce(${perStay.down}, 0)`),
      })
      .from(stays)
      .leftJoin(perStay, eq(perStay.stayId, stays.id))
      .where(and(eq(stays.unitId, unitId), lte(stays.checkIn, today)))
      .orderBy(desc(stays.checkIn))
      .limit(STATS_STAY_LIMIT);
  }

  return { totals: totals ?? ZERO, topTopics: await topTopics(db, unitId), stays: stayRows };
}

/** Answer stats across all units, for the admin (43 AC 4); units without answers are left out. */
export async function adminAnswerStats(db: Executor): Promise<AdminAnswerStats> {
  const [totals] = await db.select(totalsColumns()).from(answerFeedback);
  const unitRows = await db
    .select({
      unitId: units.id,
      unitName: units.name,
      propertyName: properties.name,
      hostEmail: accounts.email,
      stays: n(sql`count(distinct ${answerFeedback.stayId})`),
      ...totalsColumns(),
    })
    .from(answerFeedback)
    .innerJoin(stays, eq(stays.id, answerFeedback.stayId))
    .innerJoin(units, eq(units.id, stays.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .innerJoin(accounts, eq(accounts.id, properties.hostId))
    .groupBy(units.id, units.name, properties.name, accounts.email)
    .orderBy(desc(sql`count(*)`), units.name);
  return { totals: totals ?? ZERO, topTopics: await topTopics(db, null), units: unitRows };
}
