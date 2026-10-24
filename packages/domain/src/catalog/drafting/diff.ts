import type { CuratedChanges, DraftedHours, DraftedSeason } from '../../curation/vocabulary';
import { REFRESH_FIELDS, type RefreshField } from './vocabulary';

// A pre-season refresh compares a fresh draft with the verified record (ADR 0020). Only the
// factual REFRESH_FIELDS the draft has are compared: a field the pages do not mention is not a
// diff, and the description is never compared. Pure.

export interface RefreshCurrent {
  title: string;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  openingHours: DraftedHours[];
  seasons: DraftedSeason[];
}

export interface RefreshDiff {
  /** The new values of the fields that differ, with their fieldSources. */
  changes: CuratedChanges;
  /** The record's current values of those fields. */
  previous: CuratedChanges;
}

/** Case, diacritics, punctuation and whitespace folded. */
const foldName = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const foldAddress = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const digits = (s: string) => s.replace(/\D/g, '');

function foldUrl(s: string): string {
  try {
    const url = new URL(s);
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return s.trim();
  }
}

/** The database returns times as HH:MM:SS. */
const hhmm = (s: string) => s.slice(0, 5);
const hoursKey = (rows: DraftedHours[]) =>
  rows
    .map((r) => [r.weekday, hhmm(r.opens), hhmm(r.closes), r.validFrom, r.validTo].join('|'))
    .sort()
    .join(';');
const seasonsKey = (rows: DraftedSeason[]) =>
  rows
    .map((r) => [r.fromMonth, r.fromDay, r.toMonth, r.toDay].join('|'))
    .sort()
    .join(';');

function same(field: RefreshField, current: RefreshCurrent, drafted: CuratedChanges): boolean {
  switch (field) {
    case 'title':
      return foldName(current.title) === foldName(drafted.title ?? '');
    case 'address':
      return (
        current.address !== null &&
        foldAddress(current.address) === foldAddress(drafted.address ?? '')
      );
    case 'phone':
      return current.phone !== null && digits(current.phone) === digits(drafted.phone ?? '');
    case 'websiteUrl':
      return (
        current.websiteUrl !== null &&
        foldUrl(current.websiteUrl) === foldUrl(drafted.websiteUrl ?? '')
      );
    case 'openingHours':
      return hoursKey(current.openingHours) === hoursKey(drafted.openingHours ?? []);
    case 'seasons':
      return seasonsKey(current.seasons) === seasonsKey(drafted.seasons ?? []);
  }
}

export function diffRefresh(current: RefreshCurrent, drafted: CuratedChanges): RefreshDiff | null {
  const changes: CuratedChanges = {};
  const previous: CuratedChanges = {};
  const fieldSources: Record<string, string> = {};
  for (const field of REFRESH_FIELDS) {
    const value = drafted[field];
    if (value === undefined || same(field, current, drafted)) continue;
    const source = drafted.fieldSources?.[field];
    if (source) fieldSources[field] = source;
    if (field === 'openingHours') {
      changes.openingHours = drafted.openingHours;
      previous.openingHours = current.openingHours;
    } else if (field === 'seasons') {
      changes.seasons = drafted.seasons;
      previous.seasons = current.seasons;
    } else {
      changes[field] = drafted[field];
      const old = current[field];
      if (old !== null) previous[field] = old;
    }
  }
  if (Object.keys(changes).length === 0) return null;
  changes.fieldSources = fieldSources;
  return { changes, previous };
}
