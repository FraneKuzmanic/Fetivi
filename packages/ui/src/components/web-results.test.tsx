// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { WebResultsPayload } from '../payloads';
import { WebResults, type WebResultsLabels } from './source-chips/WebResults';

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

const LABELS: WebResultsLabels = {
  heading: 'From the web',
  notChecked: 'Not checked by Fetivi. Confirm on the site before you go.',
  kind: (kind) => `kind ${kind}`,
  opensInNewTab: 'opens in a new tab',
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

describe('WebResults', () => {
  it('shows each result as a new-tab link with its source chip, under the not-checked line', () => {
    const host = mount(<WebResults results={RESULTS} labels={LABELS} />);
    expect(host.querySelector('h3')?.textContent).toBe('From the web');
    expect(host.textContent).toContain(LABELS.notChecked);
    const links = [...host.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(RESULTS.map((r) => r.url));
    for (const a of links) {
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
      expect(a.textContent).toContain('opens in a new tab');
    }
    const chips = [...host.querySelectorAll('.fv-source-chip')].map((c) => c.textContent);
    expect(chips).toEqual([
      'visittrogir.hr·kind tourist_board',
      'jadrolinija.hr·kind ferry_operator',
    ]);
  });

  it('offers nothing to book or save, and no images', () => {
    const host = mount(<WebResults results={RESULTS} labels={LABELS} />);
    expect(host.querySelector('button')).toBeNull();
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.fv-place-card')).toBeNull();
  });
});
