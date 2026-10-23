import type { Executor } from '../db/client';
import type { GuestIdentity } from '../situation/claims';
import type { WebSearch } from './brave';
import { FallbackQueryError } from './errors';
import { recordFallback } from './log';
import { privateValuesOf } from './private-values';
import {
  buildBraveQuery,
  checkFallbackQuery,
  type FallbackQuery,
  type FallbackQueryInput,
} from './query';
import { filterHits, type WebResult } from './results';
import { fallbackSitesFor } from './sites';

export type WebFallbackScope = Pick<
  GuestIdentity,
  'spaceId' | 'stayId' | 'unitId' | 'propertyId' | 'destinationId'
>;

export interface WebFallbackResult {
  results: WebResult[];
}

/**
 * The web fallback: checks the query against the payload contract and the space's private
 * values, searches the allowlisted sites, re-checks every hit, and logs the call. Exactly one
 * `fallback_log` row on every path. Throws `FallbackQueryError` (nothing was sent) or
 * `WebSearchUnavailableError`.
 */
export async function webFallbackSearch(
  db: Executor,
  scope: WebFallbackScope,
  input: FallbackQueryInput,
  webSearch: WebSearch,
  now: Date,
): Promise<WebFallbackResult> {
  const logBase = {
    destinationId: scope.destinationId,
    propertyId: scope.propertyId,
    createdAt: now,
  };
  let query: FallbackQuery;
  try {
    query = checkFallbackQuery(input, await privateValuesOf(db, scope));
  } catch (error) {
    if (error instanceof FallbackQueryError) {
      await recordFallback(db, { ...logBase, outcome: 'rejected', topic: null, place: null });
    }
    throw error;
  }
  const logged = { ...logBase, topic: query.topic, place: query.place };
  const { q, sites } = buildBraveQuery(
    query.topic,
    query.place,
    await fallbackSitesFor(db, scope.destinationId),
  );
  let results: WebResult[];
  try {
    results = filterHits(await webSearch.search(q), sites);
  } catch (error) {
    await recordFallback(db, { ...logged, outcome: 'unavailable' });
    throw error;
  }
  await recordFallback(db, {
    ...logged,
    outcome: results.length > 0 ? 'results' : 'no_results',
    resultCount: results.length,
  });
  return { results };
}
