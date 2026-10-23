import { and, gte, isNotNull, lt } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { fallbackLog } from '../db/schema/fallback';
import { normalize } from '../fallback/query';
import { enqueueCurationItem } from './store';
import { CLUSTER_SAMPLE_LIMIT } from './vocabulary';

// The weekly grouping of web fallback topics into curation items (39 AC 4). Deterministic word
// sets, no model: topics are already normalized keywords. Topics derive from guest questions,
// so they are stored as fallback_log has them and never logged.

const DAY_MS = 86_400_000;

/** A topic's words, deduplicated and sorted: "Rental kayak" and "kayak rental" share a key. */
export function clusterKey(topic: string): string {
  return [...new Set(normalize(topic).split(' ').filter(Boolean))].sort().join(' ');
}

/** The UTC ISO week before the one containing `now`: Monday 00:00Z to the next Monday. */
export function previousWeek(now: Date): { start: Date; end: Date; weekStart: string } {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const end = new Date(midnight - sinceMonday * DAY_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  return { start, end, weekStart: start.toISOString().slice(0, 10) };
}

/** The distinct values, most frequent first (ties alphabetical), up to `limit`. */
function byFrequency(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .sort(([a, na], [b, nb]) => nb - na || a.localeCompare(b))
    .slice(0, limit)
    .map(([v]) => v);
}

interface Group {
  destinationId: string | null;
  key: string;
  topics: string[];
  places: string[];
  noResults: number;
}

/** Writes one fallback-topic item per destination and topic group of the previous week. */
export async function clusterFallbackTopics(
  db: Executor,
  now: Date,
): Promise<{ rows: number; clusters: number; created: number }> {
  const { start, end, weekStart } = previousWeek(now);
  const rows = await db
    .select({
      destinationId: fallbackLog.destinationId,
      topic: fallbackLog.topic,
      place: fallbackLog.place,
      outcome: fallbackLog.outcome,
    })
    .from(fallbackLog)
    .where(
      and(
        gte(fallbackLog.createdAt, start),
        lt(fallbackLog.createdAt, end),
        isNotNull(fallbackLog.topic),
      ),
    );

  const groups = new Map<string, Group>();
  for (const row of rows) {
    if (row.topic === null) continue;
    const key = clusterKey(row.topic);
    const id = `${row.destinationId ?? 'none'}:${key}`;
    let group = groups.get(id);
    if (!group) {
      group = { destinationId: row.destinationId, key, topics: [], places: [], noResults: 0 };
      groups.set(id, group);
    }
    group.topics.push(row.topic);
    if (row.place !== null) group.places.push(row.place);
    if (row.outcome === 'no_results' || row.outcome === 'unavailable') group.noResults += 1;
  }

  let created = 0;
  for (const [id, group] of groups) {
    const topics = byFrequency(group.topics, CLUSTER_SAMPLE_LIMIT);
    const result = await enqueueCurationItem(
      db,
      {
        destinationId: group.destinationId,
        dedupeKey: `fallback:${id}:${weekStart}`,
        payload: {
          kind: 'fallback_topic_cluster',
          topic: topics[0] ?? group.key,
          topics,
          places: byFrequency(group.places, CLUSTER_SAMPLE_LIMIT),
          count: group.topics.length,
          noResults: group.noResults,
          weekStart,
        },
      },
      now,
    );
    if (result.created) created += 1;
  }
  return { rows: rows.length, clusters: groups.size, created };
}
