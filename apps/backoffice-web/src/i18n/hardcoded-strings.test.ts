import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A guard against English left in the markup: every UI string comes from the locales.

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** JSX text with two letters or more between tags; not the `>` of an arrow or a generic. */
const JSX_TEXT = /(?<![=-])>\s*[^<>{}\s=;()&|?:'"`][^<>{}]*[A-Za-zČčĆćŠšŽžĐđ]{2,}[^<>{}]*</g;
/** Code the JSX pattern can still catch between a comparison and a tag: never UI text. */
const CODE = /[;=[\]]|&&|\|\||\?\.|\($|^Promise$|^[,\s]/;
/** A UI prop given as a string literal. */
const UI_PROP =
  /\b(label|hint|title|aria-label|placeholder|description|alt|caption|action)=["'][^"']*[A-Za-z]{2,}/g;

/** Text that is the same in every language: brand names and code-like tokens. */
const ALLOW = new Set([
  'Fetivi',
  'Airbnb',
  'Booking.com',
  'Stripe',
  'iCal',
  'Wi-Fi',
  'QR',
  'SVG',
  'PNG',
  'PDF',
  'URL',
  'Airbnb:',
  'Booking.com:',
  'placeholder="https',
  'placeholder="hh:mm',
  'placeholder="CC BY-SA',
  'placeholder="https://commons.wikimedia.org/wiki/File',
  'label="URL',
]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [path] : [];
  });
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

function hits(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const pattern of [JSX_TEXT, UI_PROP]) {
    for (const match of text.matchAll(pattern)) {
      const found = match[0].replace(/^>\s*|<$/g, '').trim();
      if (ALLOW.has(found) || (pattern === JSX_TEXT && CODE.test(found))) continue;
      out.push(`${relative(SRC, file)}:${lineOf(text, match.index)} ${found}`);
    }
  }
  return out;
}

describe('hard-coded strings', () => {
  it('leaves no UI text in the TSX', () => {
    expect(tsxFiles(SRC).flatMap(hits)).toEqual([]);
  });
});
