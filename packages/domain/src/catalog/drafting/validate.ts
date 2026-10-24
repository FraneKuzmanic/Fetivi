import type { CuratedChanges, DraftedHours, DraftedSeason } from '../../curation/vocabulary';
import { stripMarkup } from '../../property/sanitize';
import type { DraftExtractionData } from './schema';
import { classify } from './sources';
import { DRAFTING_LIMITS } from './vocabulary';

// The model's output is untrusted too: every field must cite a page that was actually fetched,
// and every value is cleaned and capped again. This is AC 1's "every drafted field carries its
// source URL" guarantee: a value enters `changes` only together with its fieldSources entry. Pure.

export interface ValidatedDraft {
  changes: CuratedChanges;
  /** How many fields survived. */
  fieldCount: number;
  /** A page said the place has closed for good. */
  closed: boolean;
}

const TIME = /^(?:[01]\d|2[0-4]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Markup out, and no `<` left that could start a tag. */
function clean(value: string, singleLine: boolean): string {
  return stripMarkup(value, { singleLine })
    .replace(/<(?=[a-zA-Z!/?])/g, '')
    .replace(singleLine ? /\s+/g : /[ \t]+/g, ' ')
    .trim();
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function text(value: string, max: number, singleLine = true): string | null {
  const s = cut(clean(value, singleLine), max);
  return s === '' ? null : s;
}

function phone(value: string): string | null {
  const s = clean(value, true);
  if (!/^[+\d\s()/-]+$/.test(s) || (s.match(/\d/g)?.length ?? 0) < 6) return null;
  return s.length > DRAFTING_LIMITS.phoneMax ? null : s;
}

function website(value: string): string | null {
  const ref = classify(clean(value, true));
  return ref && (ref.kind === 'venue' || ref.kind === 'social') ? ref.url : null;
}

function isDate(s: string | null): boolean {
  if (s === null) return true;
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 24:00 is midnight; a close earlier than the open means past midnight (the catalog's rule). */
const time = (s: string) => (s === '24:00' ? '00:00' : s);

function hours(rows: DraftedHours[]): DraftedHours[] | null {
  const kept = rows
    .filter(
      (r) =>
        Number.isInteger(r.weekday) &&
        r.weekday >= 1 &&
        r.weekday <= 7 &&
        TIME.test(r.opens) &&
        TIME.test(r.closes) &&
        isDate(r.validFrom) &&
        isDate(r.validTo) &&
        (r.validFrom === null || r.validTo === null || r.validFrom <= r.validTo),
    )
    .map((r) => ({ ...r, opens: time(r.opens), closes: time(r.closes) }))
    .filter((r) => r.opens !== r.closes)
    .slice(0, DRAFTING_LIMITS.hoursMax);
  return kept.length > 0 ? kept : null;
}

const inRange = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max;

function seasons(rows: DraftedSeason[]): DraftedSeason[] | null {
  const kept = rows
    .filter(
      (r) =>
        inRange(r.fromMonth, 1, 12) &&
        inRange(r.toMonth, 1, 12) &&
        inRange(r.fromDay, 1, 31) &&
        inRange(r.toDay, 1, 31),
    )
    .slice(0, DRAFTING_LIMITS.seasonsMax);
  return kept.length > 0 ? kept : null;
}

export function validateDraft(
  raw: DraftExtractionData,
  fetched: readonly string[],
): ValidatedDraft {
  const pages = new Set(fetched);
  const changes: CuratedChanges = {};
  const fieldSources: Record<string, string> = {};
  const cited = <T>(
    field: { value: T; sourceUrl: string } | null,
  ): field is {
    value: T;
    sourceUrl: string;
  } => field !== null && pages.has(field.sourceUrl);

  const put = <K extends keyof Omit<CuratedChanges, 'fieldSources'>>(
    key: K,
    value: CuratedChanges[K] | null,
    sourceUrl: string,
  ) => {
    if (value === null || value === undefined) return;
    changes[key] = value;
    fieldSources[key] = sourceUrl;
  };

  if (cited(raw.title)) {
    put('title', text(raw.title.value, DRAFTING_LIMITS.titleMax), raw.title.sourceUrl);
  }
  if (cited(raw.description)) {
    put(
      'description',
      text(raw.description.value, DRAFTING_LIMITS.descriptionMax, false),
      raw.description.sourceUrl,
    );
  }
  if (cited(raw.address)) {
    put('address', text(raw.address.value, DRAFTING_LIMITS.addressMax), raw.address.sourceUrl);
  }
  if (cited(raw.phone)) put('phone', phone(raw.phone.value), raw.phone.sourceUrl);
  if (cited(raw.websiteUrl)) {
    put('websiteUrl', website(raw.websiteUrl.value), raw.websiteUrl.sourceUrl);
  }
  if (cited(raw.openingHours)) {
    put('openingHours', hours(raw.openingHours.value), raw.openingHours.sourceUrl);
  }
  if (cited(raw.seasons)) put('seasons', seasons(raw.seasons.value), raw.seasons.sourceUrl);

  const fieldCount = Object.keys(fieldSources).length;
  if (fieldCount > 0) changes.fieldSources = fieldSources;
  return { changes, fieldCount, closed: raw.permanentlyClosed };
}
