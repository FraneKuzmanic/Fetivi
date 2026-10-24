import type { Egress } from '@fetivi/egress';
import { z } from 'zod';
import type { DraftedImage } from '../../curation/vocabulary';
import { decodeEntities } from '../../fallback/results';
import { stripMarkup } from '../../property/sanitize';
import { CATALOG_LIMITS } from '../vocabulary';
import { COMMONS_API, DRAFTING_LIMITS } from './vocabulary';

// AC 5: a drafted image comes only from Wikimedia Commons, named by the candidate's OSM tags, with
// its licence, attribution and file page (the place_images CHECK needs all three). Never from a
// venue's site or socials.

const IMAGE_HOST = 'upload.wikimedia.org';

const normaliseFile = (name: string): string | null => {
  const file = name.trim().replace(/_/g, ' ');
  return /^File:.+\.[a-z0-9]{2,5}$/i.test(file) ? file : null;
};

/** `wikimedia_commons=File:…`, or `image=` a Commons file page URL. A `Category:` is no file. */
export function commonsFileFromTags(tags: Record<string, unknown> | undefined): string | null {
  if (!tags) return null;
  const commons = tags.wikimedia_commons;
  if (typeof commons === 'string' && commons.trim().startsWith('File:')) {
    return normaliseFile(commons);
  }
  const image = tags.image;
  if (typeof image !== 'string') return null;
  try {
    const url = new URL(image.trim());
    const match = /^\/wiki\/(File:.+)$/.exec(url.pathname);
    if (url.hostname !== 'commons.wikimedia.org' || !match?.[1]) return null;
    return normaliseFile(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function commonsImageUrl(file: string): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1280',
    format: 'json',
    formatversion: '2',
    titles: file,
  });
  return `${COMMONS_API}?${params}`;
}

const MetaValue = z.object({ value: z.unknown() }).optional();
const CommonsResponse = z.object({
  query: z.object({
    pages: z.array(
      z.object({
        imageinfo: z
          .array(
            z.object({
              thumburl: z.string().optional(),
              url: z.string().optional(),
              descriptionurl: z.string().optional(),
              extmetadata: z.object({ LicenseShortName: MetaValue, Artist: MetaValue }).optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
});

const plain = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const s = decodeEntities(stripMarkup(value, { singleLine: true }))
    .replace(/\s+/g, ' ')
    .trim();
  return s === '' ? null : s.slice(0, max);
};

/** An https file on upload.wikimedia.org, without the tracking query Commons appends. */
function imageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== IMAGE_HOST) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function pageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'commons.wikimedia.org' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The image, or null when anything is missing. Commons now serves thumbnails from
 * thumb.wikimedia.org, so the original on upload.wikimedia.org (the host the catalog allows for
 * Commons images) is taken when the thumbnail is elsewhere.
 */
export function parseCommonsImage(json: unknown): DraftedImage | null {
  const parsed = CommonsResponse.safeParse(json);
  const info = parsed.success ? parsed.data.query.pages[0]?.imageinfo?.[0] : undefined;
  if (!info) return null;
  const url = imageUrl(info.thumburl) ?? imageUrl(info.url);
  const sourcePageUrl = pageUrl(info.descriptionurl);
  const licence = plain(info.extmetadata?.LicenseShortName?.value, CATALOG_LIMITS.licence);
  const attribution = plain(info.extmetadata?.Artist?.value, CATALOG_LIMITS.attribution);
  if (!url || !sourcePageUrl || !licence || !attribution) return null;
  return { url, licence, attribution, sourcePageUrl };
}

/** Errors give null: a missing image never fails a draft. */
export async function fetchCommonsImage(
  fetch: Egress['fetch'],
  userAgent: string,
  file: string,
): Promise<DraftedImage | null> {
  try {
    const response = await fetch(commonsImageUrl(file), {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(DRAFTING_LIMITS.fetchTimeoutMs),
    });
    if (!response.ok) return null;
    return parseCommonsImage(await response.json());
  } catch {
    return null;
  }
}
