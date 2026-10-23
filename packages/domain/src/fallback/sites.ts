import { and, eq, isNotNull } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { catalogRecords } from '../db/schema/catalog';
import { FALLBACK_SITES, type FallbackSite, VENUE_HOST_DENYLIST } from './vocabulary';

const under = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/**
 * Venues' own sites from catalog website URLs: https hosts without `www.`, minus shared platforms
 * (and their subdomains), hosts already `taken`, and duplicates. Alphabetical, so the query is
 * the same for the same catalog.
 */
export function venueSites(
  urls: readonly (string | null)[],
  taken: ReadonlySet<string>,
): FallbackSite[] {
  const hosts = new Set<string>();
  for (const value of urls) {
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:') continue;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) continue;
    if (VENUE_HOST_DENYLIST.some((denied) => under(host, denied))) continue;
    if ([...taken].some((t) => under(host, t))) continue;
    hosts.add(host);
  }
  return [...hosts].sort().map((host) => ({ host, kind: 'venue' }));
}

/**
 * The sites a web fallback search may name: the static list, plus, inside a destination, the
 * sites of its published catalog records.
 */
export async function fallbackSitesFor(
  db: Executor,
  destinationId: string | null,
): Promise<FallbackSite[]> {
  if (!destinationId) return [...FALLBACK_SITES];
  const rows = await db
    .select({ websiteUrl: catalogRecords.websiteUrl })
    .from(catalogRecords)
    .where(
      and(
        eq(catalogRecords.destinationId, destinationId),
        isNotNull(catalogRecords.publishedRevision),
        isNotNull(catalogRecords.websiteUrl),
      ),
    );
  const taken = new Set(FALLBACK_SITES.map((s) => s.host));
  return [
    ...FALLBACK_SITES,
    ...venueSites(
      rows.map((r) => r.websiteUrl),
      taken,
    ),
  ];
}
