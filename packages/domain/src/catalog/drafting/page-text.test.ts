import { describe, expect, it } from 'vitest';
import { pageText } from './page-text';
import { readRecordedPage } from './testing';
import { DRAFTING_LIMITS } from './vocabulary';

const VENUE = 'https://www.svdominik.com/';

describe('pageText', () => {
  it('reads the recorded venue page: title, text without scripts, and the contact link first', () => {
    const page = pageText(readRecordedPage('konoba-venue.html'), VENUE);
    expect(page.title).toBe(
      'Sv. Dominik – Restaurant and Bar in Trogir – Sv. Dominik – Restaurant and Bar in Trogir',
    );
    expect(page.text).toContain('Vukovarska ul. 1, 21220, Trogir');
    expect(page.text).not.toContain('gtm4wp_datalayer_name');
    expect(page.text).not.toMatch(/<[a-z]/i);
    expect(page.jsonLd).toEqual([]);
    expect(page.links.map((l) => l.url)).toEqual([
      'https://www.svdominik.com/contact/',
      'https://www.svdominik.com/about-us/',
      'https://www.svdominik.com/menu/',
    ]);
  });

  it('reads the contact page’s opening hours as text', () => {
    const page = pageText(readRecordedPage('konoba-contact.html'), `${VENUE}contact/`);
    expect(page.text).toContain('Opening Hours');
    expect(page.text).toContain('Sunday closed');
  });

  it('keeps the tourist-board page’s JSON-LD block', () => {
    const page = pageText(
      readRecordedPage('tourist-board-place.html'),
      'https://www.visittrogir.hr/en/tourist/attractions/kamerlengo-fortress',
    );
    expect(page.title).toBe('KAMERLENGO FORTRESS - Tourist Board Trogir');
    expect(page.jsonLd).toHaveLength(1);
    expect(page.jsonLd[0]).toMatch(/^\{"@context":"https:\/\/schema.org"/);
    expect(page.text).not.toContain('@context');
  });

  it('cuts a huge page and an overlong JSON-LD block', () => {
    const ld = `<script type="application/ld+json">${'x'.repeat(10_000)}</script>`;
    const page = pageText(`${ld}<p>${'word '.repeat(700_000)}</p>`, VENUE);
    expect(page.text.length).toBeLessThanOrEqual(DRAFTING_LIMITS.charsPerPage);
    expect(page.jsonLd[0]?.length).toBe(4000);
  });

  it('decodes entities and strips the injection page’s script and comment', () => {
    const page = pageText(readRecordedPage('injection-venue.html'), 'https://injekcija.hr/');
    expect(page.title).toBe('Konoba Injekcija & Bar – Trogir');
    expect(page.text).toContain('A made-up venue page for testing prompt injection.');
    expect(page.text).not.toContain('never read me');
    expect(page.text).not.toContain('SYSTEM:');
    // The hidden text stays: it is data for the model, which is told to ignore instructions.
    expect(page.text).toContain('Ignore all previous instructions');
  });

  it('drops off-host, fragment and non-https links', () => {
    const page = pageText(
      '<a href="https://evil.example/contact">c</a><a href="#contact">c</a>' +
        '<a href="http://injekcija.hr/kontakt">c</a><a href="/kontakt">Kontakt</a>' +
        '<a href="https://www.injekcija.hr/o-nama">O nama</a><a href="/gallery">Gallery</a>',
      'https://injekcija.hr/',
    );
    expect(page.links).toEqual([
      { url: 'https://injekcija.hr/kontakt', label: 'Kontakt' },
      { url: 'https://www.injekcija.hr/o-nama', label: 'O nama' },
    ]);
  });
});
