// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type PropertyInfoPayload, propertyInfo } from '../payloads';
import { projection } from './fixtures';
import { PropertyInfoCard, type PropertyInfoLabels } from './property-info-card/PropertyInfoCard';

const LABELS: PropertyInfoLabels = {
  title: (topic) => `Title ${topic}`,
  field: (key) => `Label ${key}`,
  value: (_key, raw) => raw,
  releaseNote: (releaseAt) => `Shown from ${releaseAt}`,
  noWifi: 'No Wi-Fi here',
  copy: (label) => `Copy ${label}`,
  copied: 'Copied',
  copyFailed: 'Selected; copy it by hand',
  call: (label) => `Call ${label}`,
};

let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mount(info: PropertyInfoPayload) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <PropertyInfoCard info={info} mediaUrl={(id) => `/api/media/${id}`} labels={LABELS} />,
    ),
  );
  return host;
}

const buttonNamed = (host: HTMLElement, name: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

describe('PropertyInfoCard', () => {
  it('renders the fields as a description list under a labelled section', () => {
    const host = mount(propertyInfo(projection(true), 'arrival'));
    const section = host.querySelector('section');
    const title = host.querySelector('h3');
    expect(section?.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(title?.textContent).toBe('Title arrival');
    expect([...host.querySelectorAll('dt')].map((d) => d.textContent)).toContain(
      'Label lockboxCode',
    );
    expect(host.querySelector('code')?.textContent).toBe('B-1234');
  });

  it('copies the exact secret and announces it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const host = mount(propertyInfo(projection(true), 'wifi'));
    await act(async () => buttonNamed(host, 'Copy Label wifiPassword').click());
    expect(writeText).toHaveBeenCalledWith('sea-breeze-55');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Copied');
  });

  it('says to copy by hand when the clipboard is refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const host = mount(propertyInfo(projection(true), 'wifi'));
    await act(async () => buttonNamed(host, 'Copy Label wifiNetwork').click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Selected; copy it by hand');
  });

  it('links phones with only digits and the plus sign', () => {
    const host = mount(propertyInfo(projection(true), 'contacts'));
    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['tel:112', 'tel:+385910001111', 'tel:+385910002222']);
  });

  it('shows when gated details appear', () => {
    const host = mount(propertyInfo(projection(false), 'arrival'));
    expect(host.querySelector('.fv-info-release')?.textContent).toBe(
      'Shown from 2026-10-19T22:00:00.000Z',
    );
    expect(host.textContent).not.toContain('L-9020');
  });

  it('says there is no Wi-Fi', () => {
    const host = mount(propertyInfo(projection(true, { wifi: null }), 'wifi'));
    expect(host.textContent).toContain('No Wi-Fi here');
  });

  it('shows every caption under its item, and gives images it as alt text', () => {
    const host = mount({
      ...propertyInfo(projection(true), 'arrival'),
      media: [
        { id: 'm1', kind: 'image', caption: 'The lockbox by the door' },
        { id: 'm2', kind: 'video', caption: 'Opening the gate' },
      ],
    });
    const img = host.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('The lockbox by the door');
    expect(img?.getAttribute('src')).toBe('/api/media/m1');
    expect(host.querySelector('img + figcaption')?.textContent).toBe('The lockbox by the door');
    const video = host.querySelector('video');
    const caption = host.querySelector('video + figcaption');
    expect(caption?.textContent).toBe('Opening the gate');
    expect(video?.getAttribute('aria-describedby')).toBe(caption?.id);
  });
});
