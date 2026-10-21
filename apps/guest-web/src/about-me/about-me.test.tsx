import {
  type AboutMe,
  BUDGETS,
  EMPTY_ABOUT_ME,
  INTERESTS,
  NEEDS,
  PACES,
  PARTY_SHAPES,
} from '@fetivi/domain/about-me-vocabulary';
import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { Space } from '../api';
import { locales, setLanguage } from '../i18n';
import { SpaceProvider } from '../space';
import { AboutMePage } from './AboutMePage';
import { ChoiceGroup } from './ChoiceGroup';
import { STEPS, TripFlow } from './TripFlow';

afterEach(() => setLanguage('en'));

const space = (closed = false): Space => ({
  language: 'en',
  closedAt: '2026-10-26T23:00:00.000Z',
  closed,
  unitSlug: 'qrabc',
});

const render = (node: ReactNode, closed = false) =>
  renderToString(
    <MemoryRouter>
      <SpaceProvider initial={{ status: 'ready', space: space(closed) }}>{node}</SpaceProvider>
    </MemoryRouter>,
  );

// renderToString escapes apostrophes and quotes.
const html = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll("'", '&#x27;').replaceAll('"', '&quot;');

const FULL: AboutMe = {
  party: 'family',
  interests: ['beaches', 'food'],
  pace: 'easy',
  budget: 'mid',
  needs: ['gluten_free'],
};
const en = locales.en;

describe('ChoiceGroup', () => {
  it('is a radio group for one choice and toggle buttons for many', () => {
    const single = render(
      <ChoiceGroup
        labelId="q"
        codes={PACES}
        labelOf={(c) => c}
        selected={['mixed']}
        multiple={false}
        onChange={() => {}}
      />,
    );
    expect(single).toContain('role="radiogroup" aria-labelledby="q"');
    expect(single).toMatch(/role="radio" aria-checked="true"[^>]*>.*mixed/);
    expect(single.match(/aria-checked="false"/g)).toHaveLength(2);

    const multi = render(
      <ChoiceGroup
        labelId="q"
        codes={INTERESTS}
        labelOf={(c) => c}
        selected={['food', 'slow']}
        multiple
        onChange={() => {}}
      />,
    );
    expect(multi).toContain('<fieldset aria-labelledby="q"');
    expect(multi.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(multi).not.toContain('role="radio"');
  });
});

describe('TripFlow', () => {
  it('asks the five questions in order with their codes', () => {
    expect(STEPS.map((s) => [s.field, s.title, s.codes])).toEqual([
      ['party', 'aboutMe.partyTitle', PARTY_SHAPES],
      ['interests', 'aboutMe.interestsTitle', INTERESTS],
      ['pace', 'aboutMe.paceTitle', PACES],
      ['budget', 'aboutMe.budgetTitle', BUDGETS],
      ['needs', 'aboutMe.needsTitle', NEEDS],
    ]);
  });

  it('opens on who is travelling, with Skip and Next but no Back', () => {
    const out = render(<TripFlow initial={EMPTY_ABOUT_ME} onFinish={() => {}} />);
    expect(out).toContain('Question 1 of 5');
    expect(out).toContain(html(en.aboutMe.partyTitle));
    const labels = PARTY_SHAPES.map((c) => out.indexOf(html(en.party[c])));
    expect(labels.every((i) => i > -1)).toBe(true);
    expect([...labels].sort((a, b) => a - b)).toEqual(labels);
    expect(out).toContain('>Skip<');
    expect(out).toContain('>Next<');
    expect(out).not.toContain('>Back<');
    expect(out).not.toContain(html(en.aboutMe.needsNote));
  });

  it('preselects what is saved', () => {
    const out = render(<TripFlow initial={FULL} onFinish={() => {}} />);
    expect(out).toMatch(/aria-checked="true"[^>]*>.*Family with kids/);
  });

  it('ends on needs under the one-line note, with Back and Done', () => {
    const out = render(<TripFlow initial={FULL} step={4} onFinish={() => {}} />);
    expect(out).toContain('Question 5 of 5');
    expect(out).toContain(html(en.aboutMe.needsTitle));
    expect(out).toContain(html(en.aboutMe.needsNote));
    expect(out).toContain('>Back<');
    expect(out).toContain('>Done<');
    expect(out).toMatch(/aria-pressed="true"[^>]*>.*Gluten-free \(coeliac\)/);
  });
});

describe('AboutMePage', () => {
  it('lists every saved item with Remove, and Change per section', () => {
    const out = render(<AboutMePage initial={FULL} />);
    expect(out).toContain(html(en.aboutMe.intro));
    for (const label of [
      en.party.family,
      en.interest.beaches,
      en.interest.food,
      en.pace.easy,
      en.budget.mid,
      en.need.gluten_free,
    ]) {
      expect(out).toContain(html(label));
      expect(out).toContain(`aria-label="Remove ${html(label)}"`);
    }
    expect(out.match(/>Change</g)).toHaveLength(5);
    expect(out).toContain(html(en.aboutMe.needsNote));
    expect(out).not.toContain(html(en.aboutMe.closedNote));
  });

  it('after the stay keeps Remove but not Change', () => {
    const out = render(<AboutMePage initial={{ ...FULL, budget: null }} />, true);
    expect(out).toContain(html(en.aboutMe.closedNote));
    expect(out).not.toContain('>Change<');
    expect(out).toContain(`aria-label="Remove ${html(en.pace.easy)}"`);
    // An empty field has nothing to show once nothing can be added.
    expect(out).not.toContain(html(en.aboutMe.budgetTitle));
  });

  it('invites the guest to start when nothing is saved', () => {
    const out = render(<AboutMePage initial={EMPTY_ABOUT_ME} />);
    expect(out).toContain(html(en.aboutMe.empty));
    expect(out).toContain(`>${html(en.aboutMe.start)}<`);
    expect(out).not.toContain('aria-label="Remove');
    expect(out.match(/>Change</g)).toHaveLength(5);
  });

  it('has its title in every guest language', () => {
    for (const language of GUEST_LANGUAGES) {
      setLanguage(language);
      expect(render(<AboutMePage initial={FULL} />), language).toContain(
        html(locales[language].aboutMe.title),
      );
    }
  });
});
