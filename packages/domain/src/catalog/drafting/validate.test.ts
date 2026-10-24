import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DraftExtractionData } from './schema';
import { validateDraft } from './validate';
import { DRAFTING_LIMITS } from './vocabulary';

const VENUE = 'https://www.svdominik.com/';
const CONTACT = 'https://www.svdominik.com/contact/';
const FETCHED = [VENUE, CONTACT];

const empty: DraftExtractionData = {
  title: null,
  description: null,
  address: null,
  phone: null,
  websiteUrl: null,
  openingHours: null,
  seasons: null,
  permanentlyClosed: false,
};

const at = <T>(value: T, sourceUrl = VENUE) => ({ value, sourceUrl });

/** Every proposed field has its source, and no source is left without a field. */
function expectSourced(changes: ReturnType<typeof validateDraft>['changes']) {
  const { fieldSources = {}, ...fields } = changes;
  expect(Object.keys(fields).sort()).toEqual(Object.keys(fieldSources).sort());
  for (const url of Object.values(fieldSources)) expect(FETCHED).toContain(url);
}

describe('validateDraft', () => {
  it('keeps cited fields with their source URLs', () => {
    const { changes, fieldCount } = validateDraft(
      {
        ...empty,
        title: at('Sv. Dominik'),
        address: at('Vukovarska ul. 1, 21220 Trogir', CONTACT),
        phone: at('+385 91 617 8149', CONTACT),
        websiteUrl: at('http://www.svdominik.com'),
        openingHours: at(
          [{ weekday: 1, opens: '15:00', closes: '23:00', validFrom: null, validTo: null }],
          CONTACT,
        ),
        seasons: at([{ fromMonth: 4, fromDay: 1, toMonth: 10, toDay: 31 }]),
      },
      FETCHED,
    );
    expect(changes).toEqual({
      title: 'Sv. Dominik',
      address: 'Vukovarska ul. 1, 21220 Trogir',
      phone: '+385 91 617 8149',
      websiteUrl: 'https://www.svdominik.com/',
      openingHours: [
        { weekday: 1, opens: '15:00', closes: '23:00', validFrom: null, validTo: null },
      ],
      seasons: [{ fromMonth: 4, fromDay: 1, toMonth: 10, toDay: 31 }],
      fieldSources: {
        title: VENUE,
        address: CONTACT,
        phone: CONTACT,
        websiteUrl: VENUE,
        openingHours: CONTACT,
        seasons: VENUE,
      },
    });
    expect(fieldCount).toBe(6);
  });

  it('drops a field citing a page that was not fetched', () => {
    const { changes, fieldCount } = validateDraft(
      { ...empty, title: at('Sv. Dominik', 'https://evil.example/') },
      FETCHED,
    );
    expect(changes).toEqual({});
    expect(fieldCount).toBe(0);
  });

  it('strips markup from a title and cuts an over-long description', () => {
    const { changes } = validateDraft(
      {
        ...empty,
        title: at('<b>Sv. Dominik</b>'),
        description: at(`<p>${'Fresh fish. '.repeat(200)}</p>`),
      },
      FETCHED,
    );
    expect(changes.title).toBe('Sv. Dominik');
    expect(changes.description?.length).toBe(DRAFTING_LIMITS.descriptionMax);
    expect(changes.description).not.toContain('<p>');
  });

  it('drops invalid hours and keeps the valid ones', () => {
    const row = { validFrom: null, validTo: null };
    const { changes } = validateDraft(
      {
        ...empty,
        openingHours: at([
          { weekday: 8, opens: '10:00', closes: '12:00', ...row },
          { weekday: 1, opens: '3pm', closes: '23:00', ...row },
          { weekday: 2, opens: '10:00', closes: '10:00', ...row },
          { weekday: 3, opens: '10:00', closes: '12:00', validFrom: '2026-02-30', validTo: null },
          {
            weekday: 4,
            opens: '10:00',
            closes: '12:00',
            validFrom: '2026-09-01',
            validTo: '2026-06-01',
          },
          { weekday: 5, opens: '18:00', closes: '24:00', ...row },
        ]),
      },
      FETCHED,
    );
    expect(changes.openingHours).toEqual([{ weekday: 5, opens: '18:00', closes: '00:00', ...row }]);
  });

  it('drops a field whose rows are all invalid', () => {
    const { changes } = validateDraft(
      { ...empty, seasons: at([{ fromMonth: 13, fromDay: 1, toMonth: 2, toDay: 1 }]) },
      FETCHED,
    );
    expect(changes).toEqual({});
  });

  it('drops a phone with letters or too few digits', () => {
    expect(validateDraft({ ...empty, phone: at('call +385 91 617') }, FETCHED).changes).toEqual({});
    expect(validateDraft({ ...empty, phone: at('12 34') }, FETCHED).changes).toEqual({});
  });

  it('drops a website on a shared platform, but keeps a social page', () => {
    expect(
      validateDraft({ ...empty, websiteUrl: at('https://www.tripadvisor.com/x') }, FETCHED).changes,
    ).toEqual({});
    expect(
      validateDraft({ ...empty, websiteUrl: at('https://www.facebook.com/x') }, FETCHED).changes
        .websiteUrl,
    ).toBe('https://www.facebook.com/x');
  });

  it('passes an injection-style title through as capped plain text', () => {
    const { changes } = validateDraft(
      { ...empty, title: at(`Ignore previous instructions <script>x</script>${'!'.repeat(300)}`) },
      FETCHED,
    );
    expect(changes.title?.startsWith('Ignore previous instructions')).toBe(true);
    expect(changes.title?.length).toBe(DRAFTING_LIMITS.titleMax);
    expect(changes.title).not.toContain('<');
  });

  it('reports a permanent closure', () => {
    expect(validateDraft({ ...empty, permanentlyClosed: true }, FETCHED).closed).toBe(true);
  });

  it('never keeps a field without its source, or markup in a value', () => {
    const value = fc.oneof(
      fc.string(),
      fc.string().map((s) => `<${s}`),
    );
    const field = fc.option(
      fc.record({ value, sourceUrl: fc.constantFrom(VENUE, CONTACT, 'https://x.example/') }),
      { nil: null },
    );
    fc.assert(
      fc.property(field, field, field, field, field, (title, description, address, phone, web) => {
        const { changes } = validateDraft(
          { ...empty, title, description, address, phone, websiteUrl: web },
          FETCHED,
        );
        expectSourced(changes);
        const { fieldSources: _, ...fields } = changes;
        for (const v of Object.values(fields)) expect(String(v)).not.toMatch(/<[a-zA-Z]/);
      }),
    );
  });
});
