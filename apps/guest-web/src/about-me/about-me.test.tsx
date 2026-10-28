import {
  type AboutMe,
  BUDGETS,
  EMPTY_ABOUT_ME,
  INTERESTS,
  NEEDS,
  PACES,
  PARTY_SHAPES,
  TRANSPORTS,
} from '@fetivi/domain/about-me-vocabulary';
import { GUEST_LANGUAGES } from '@fetivi/domain/vocabulary';
import { radioMove } from '@fetivi/ui';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { Space } from '../api';
import { locales, setLanguage } from '../i18n';
import { SpaceProvider } from '../space';
import { AboutMePage, saveQueue } from './AboutMePage';
import { ChoiceGroup } from './ChoiceGroup';
import { STEPS, TripFlow } from './TripFlow';

afterEach(() => setLanguage('en'));

const space = (closed = false): Space => ({
  language: 'en',
  closedAt: '2026-10-26T23:00:00.000Z',
  closed,
  unitSlug: 'qrabc',
  keepForEvaluation: false,
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
  transport: 'car',
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

  it('makes a radio group one Tab stop: the chosen option, else the first', () => {
    const tabStops = (selected: string[]) =>
      render(
        <ChoiceGroup
          labelId="q"
          codes={PACES}
          labelOf={(c) => c}
          selected={selected as never}
          multiple={false}
          onChange={() => {}}
        />,
      ).match(/tabindex="(-1|0)"/g);
    expect(tabStops(['mixed'])).toEqual(['tabindex="-1"', 'tabindex="0"', 'tabindex="-1"']);
    expect(tabStops([])).toEqual(['tabindex="0"', 'tabindex="-1"', 'tabindex="-1"']);
  });

  it('moves through a radio group with the arrow keys, wrapping at the ends', () => {
    expect(radioMove('ArrowRight', 0, 3)).toBe(1);
    expect(radioMove('ArrowDown', 2, 3)).toBe(0);
    expect(radioMove('ArrowLeft', 0, 3)).toBe(2);
    expect(radioMove('ArrowUp', 1, 3)).toBe(0);
    expect(radioMove('Tab', 1, 3)).toBeNull();
    expect(radioMove('Enter', 1, 3)).toBeNull();
  });
});

describe('TripFlow', () => {
  it('asks the six questions in order with their codes', () => {
    expect(STEPS.map((s) => [s.field, s.title, s.codes])).toEqual([
      ['party', 'aboutMe.partyTitle', PARTY_SHAPES],
      ['interests', 'aboutMe.interestsTitle', INTERESTS],
      ['pace', 'aboutMe.paceTitle', PACES],
      ['budget', 'aboutMe.budgetTitle', BUDGETS],
      ['transport', 'aboutMe.transportTitle', TRANSPORTS],
      ['needs', 'aboutMe.needsTitle', NEEDS],
    ]);
  });

  it('opens on who is travelling, with Skip and Next but no Back', () => {
    const out = render(<TripFlow initial={EMPTY_ABOUT_ME} onFinish={() => {}} />);
    expect(out).toContain('Question 1 of 6');
    expect(out).toContain(html(en.aboutMe.partyTitle));
    const labels = PARTY_SHAPES.map((c) => out.indexOf(html(en.party[c])));
    expect(labels.every((i) => i > -1)).toBe(true);
    expect([...labels].sort((a, b) => a - b)).toEqual(labels);
    expect(out).toContain('>Skip<');
    expect(out).toContain('>Next<');
    expect(out).not.toContain('>Back<');
  });

  it('preselects what is saved', () => {
    const out = render(<TripFlow initial={FULL} onFinish={() => {}} />);
    expect(out).toMatch(/aria-checked="true"[^>]*>.*Family with kids/);
  });

  it('asks how they get around as one choice', () => {
    const out = render(<TripFlow initial={FULL} startStep={4} onFinish={() => {}} />);
    expect(out).toContain('Question 5 of 6');
    expect(out).toContain(html(en.aboutMe.transportTitle));
    expect(out).toContain('role="radiogroup"');
    for (const code of TRANSPORTS) expect(out).toContain(html(en.transport[code]));
    expect(out).toMatch(/aria-checked="true"[^>]*>(<svg.*?<\/svg>)?Car</);
  });

  it('ends on needs without a note, with Back and Done', () => {
    const out = render(<TripFlow initial={FULL} startStep={5} onFinish={() => {}} />);
    expect(out).toContain('Question 6 of 6');
    expect(out).toContain(html(en.aboutMe.needsTitle));
    expect(out).not.toContain('needs-note');
    expect(out).toContain('>Back<');
    expect(out).toContain('>Done<');
    expect(out).toMatch(/aria-pressed="true"[^>]*>(<svg.*?<\/svg>)?Gluten-free</);
    expect(out).not.toContain('Halal');
    expect(out).not.toContain('Kosher');
    expect(out.match(/aria-pressed=/g)).toHaveLength(NEEDS.length);
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
      en.transport.car,
      en.need.gluten_free,
    ]) {
      expect(out).toContain(html(label));
      expect(out).toContain(`aria-label="Remove ${html(label)}"`);
    }
    expect(out.match(/>Change</g)).toHaveLength(6);
    expect(out).not.toContain('needs-note');
    expect(out.indexOf(html(en.transport.car))).toBeGreaterThan(
      out.indexOf(html(en.aboutMe.transportTitle)),
    );
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

  it('says so for a question not answered yet', () => {
    const out = render(<AboutMePage initial={{ ...FULL, pace: null }} />);
    expect(out.match(new RegExp(`>${html(en.aboutMe.notSet)}<`, 'g'))).toHaveLength(1);
    expect(out.indexOf(html(en.aboutMe.notSet))).toBeGreaterThan(
      out.indexOf(html(en.aboutMe.paceTitle)),
    );
  });

  it('invites the guest to start when nothing is saved', () => {
    const out = render(<AboutMePage initial={EMPTY_ABOUT_ME} />);
    expect(out).toContain(html(en.aboutMe.empty));
    expect(out.match(new RegExp(`>${html(en.aboutMe.notSet)}<`, 'g'))).toHaveLength(6);
    expect(out).toContain(`>${html(en.aboutMe.start)}<`);
    expect(out).not.toContain('aria-label="Remove');
    expect(out.match(/>Change</g)).toHaveLength(6);
  });

  it('keeps its title for screen readers only', () => {
    const out = render(<AboutMePage initial={FULL} />);
    expect(out).toMatch(/<h1 id="tab-title" tabindex="-1" class="visually-hidden">About me<\/h1>/);
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

describe('saveQueue', () => {
  const value = (budget: AboutMe['budget']): AboutMe => ({ ...EMPTY_ABOUT_ME, budget });
  type Pending = { next: AboutMe; resolve: (v: AboutMe) => void; reject: () => void };

  const setup = () => {
    const pending: Pending[] = [];
    const settled: [AboutMe | null, boolean][] = [];
    const queue = saveQueue(
      (next) =>
        new Promise<AboutMe>((resolve, reject) =>
          pending.push({ next, resolve, reject: () => reject(new Error('offline')) }),
        ),
      (shown, failed) => settled.push([shown, failed]),
    );
    queue.confirm(value(null));
    // Lets the chain reach the next send.
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { pending, settled, queue, tick };
  };

  it('sends saves one at a time, in tap order', async () => {
    const { pending, queue, tick } = setup();
    void queue.save(value('simple'));
    void queue.save(value('mid'));
    await tick();
    expect(pending.map((p) => p.next.budget)).toEqual(['simple']);
    pending[0]?.resolve(value('simple'));
    await tick();
    expect(pending.map((p) => p.next.budget)).toEqual(['simple', 'mid']);
  });

  it('puts the confirmed value back when the newest save fails', async () => {
    const { pending, settled, queue, tick } = setup();
    void queue.save(value('simple'));
    await tick();
    pending[0]?.reject();
    await tick();
    expect(settled).toEqual([[value(null), true]]);
  });

  it('keeps an older failed change that a newer save stored after all', async () => {
    const { pending, settled, queue, tick } = setup();
    const a = { ...value(null), pace: 'easy' as const };
    const b = { ...a, budget: 'mid' as const };
    void queue.save(a);
    void queue.save(b);
    await tick();
    pending[0]?.reject();
    await tick();
    // The older failure does not roll the screen back while a newer save is on its way.
    expect(settled).toEqual([]);
    pending[1]?.resolve(b);
    await tick();
    expect(settled).toEqual([[b, false]]);
  });
});
