// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WebResultsPayload } from '../payloads';
import { type CitationLabels, CitedText } from './source-chips/CitedText';
import { citesAny, parseCitations, siteName, uncitedText } from './source-chips/citations';
import { SourceRow } from './source-chips/SourceRow';

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

const LABELS: CitationLabels = {
  notChecked: 'Not checked by Fetivi.',
  kind: (kind) => `kind ${kind}`,
  opensInNewTab: 'opens in a new tab',
  open: (site) => `Source: ${site}`,
};

const RESULTS: WebResultsPayload['results'] = [
  {
    title: 'Kayaking around Trogir',
    snippet: 'Sea kayak tours around Čiovo.',
    url: 'https://www.visittrogir.hr/en/kayak',
    source: { host: 'visittrogir.hr', kind: 'tourist_board' },
  },
  {
    title: 'Split – Supetar',
    snippet: 'Car ferry timetable.',
    url: 'https://www.jadrolinija.hr/en/split-supetar',
    source: { host: 'jadrolinija.hr', kind: 'ferry_operator' },
  },
];

describe('parseCitations', () => {
  it('splits markers in range off the text, hugging the sentence', () => {
    expect(parseCitations('Tours run daily [1]. Ferries too [2].', 2)).toEqual([
      { text: 'Tours run daily' },
      { ref: 0 },
      { text: '. Ferries too' },
      { ref: 1 },
      { text: '.' },
    ]);
  });

  it('drops markers with no result, including [0]', () => {
    expect(parseCitations('A [3] B [0].', 2)).toEqual([{ text: 'A B.' }]);
  });

  it('leaves other bracket text as written', () => {
    expect(parseCitations('See [a], [1, 2] and [123].', 2)).toEqual([
      { text: 'See [a], [1, 2] and [123].' },
    ]);
  });

  it('shows the same citation twice in a row once', () => {
    expect(parseCitations('Open daily [1][1].', 2)).toEqual([
      { text: 'Open daily' },
      { ref: 0 },
      { text: '.' },
    ]);
  });

  it('tells cited text and strips markers for reading out', () => {
    expect(citesAny('Open daily [1].', 2)).toBe(true);
    expect(citesAny('Open daily [5].', 2)).toBe(false);
    expect(uncitedText('Open daily [1]. Ferries [2].', 2)).toBe('Open daily. Ferries.');
  });
});

describe('siteName', () => {
  it('names a site by its first label without www', () => {
    expect(siteName('www.visittrogir.hr')).toBe('visittrogir');
    expect(siteName('split.gov.hr')).toBe('split');
    expect(siteName('jadrolinija.hr')).toBe('jadrolinija');
  });
});

const badges = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.fv-cite')];
const popover = (host: HTMLElement) => host.querySelector<HTMLElement>('.fv-cite-pop');

describe('CitedText', () => {
  const cited = () =>
    mount(
      <p>
        <CitedText text="Kayaks daily [1]. Ferries [2]." results={RESULTS} labels={LABELS} />
      </p>,
    );

  it('shows each citation as a badge of the site, closed', () => {
    const host = cited();
    expect(host.textContent).toBe('Kayaks dailyvisittrogir. Ferriesjadrolinija.');
    const [first] = badges(host);
    expect(first?.getAttribute('aria-label')).toBe('Source: visittrogir.hr');
    expect(first?.getAttribute('aria-expanded')).toBe('false');
    expect(popover(host)).toBeNull();
  });

  it('opens a preview on click with the title, source, snippet, note and a safe link', () => {
    const host = cited();
    const [first] = badges(host);
    act(() => first?.click());
    expect(first?.getAttribute('aria-expanded')).toBe('true');
    const pop = popover(host);
    expect(pop?.getAttribute('role')).toBe('dialog');
    expect(first?.getAttribute('aria-controls')).toBe(pop?.id);
    expect(pop?.textContent).toContain('Sea kayak tours around Čiovo.');
    expect(pop?.textContent).toContain('Not checked by Fetivi.');
    expect(pop?.querySelector('.fv-source-chip')?.textContent).toBe(
      'visittrogir.hr·kind tourist_board',
    );
    const link = pop?.querySelector('a');
    expect(link?.textContent).toContain('Kayaking around Trogir');
    expect(link?.getAttribute('href')).toBe(RESULTS[0]?.url);
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer nofollow');
    // A second click closes it.
    act(() => first?.click());
    expect(popover(host)).toBeNull();
  });

  it('scrolls a tapped preview clear of the composer, never a hovered one', () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const host = cited();
    const [first, second] = badges(host);
    act(() => {
      second?.dispatchEvent(
        new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }),
      );
      second?.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    });
    expect(scroll).not.toHaveBeenCalled();
    act(() => first?.click());
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    scroll.mockRestore();
  });

  it('closes on Escape and gives focus back to the badge', () => {
    const host = cited();
    const [first] = badges(host);
    act(() => first?.click());
    const link = popover(host)?.querySelector('a');
    link?.focus();
    act(() => {
      link?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(popover(host)).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it('opens on mouse hover and closes on a press outside', () => {
    const host = cited();
    const [, second] = badges(host);
    act(() => {
      second?.dispatchEvent(
        new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true }),
      );
      second?.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
    });
    expect(popover(host)?.textContent).toContain('Car ferry timetable.');
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(popover(host)).toBeNull();
  });

  it('opens nothing on a touch hover; the tap does it', () => {
    const host = cited();
    const [first] = badges(host);
    act(() => {
      first?.dispatchEvent(
        new PointerEvent('pointerover', { pointerType: 'touch', bubbles: true }),
      );
      first?.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
    });
    expect(popover(host)).toBeNull();
  });
});

describe('SourceRow', () => {
  it('shows each result as one new-tab link with its site, under one label', () => {
    const host = mount(
      <SourceRow
        results={RESULTS}
        labels={{ label: 'From the web', kind: LABELS.kind, opensInNewTab: 'opens in a new tab' }}
      />,
    );
    const list = host.querySelector('ul');
    const label = host.querySelector('.fv-source-row-label');
    expect(list?.getAttribute('aria-labelledby')).toBe(label?.id);
    expect(label?.textContent).toBe('From the web');
    const links = [...host.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(RESULTS.map((r) => r.url));
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toBe('noopener noreferrer nofollow');
      expect(a.textContent).toContain('opens in a new tab');
    }
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
  });
});
