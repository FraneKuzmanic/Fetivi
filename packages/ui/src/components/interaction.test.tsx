// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FollowUpChips } from './chips/FollowUpChips';
import { ChoiceCard } from './choice-card/ChoiceCard';
import { LABELS, place } from './fixtures';
import { PlaceCarousel } from './place-carousel/PlaceCarousel';

vi.mock('./map-list/map', async (original) => ({
  ...(await original<typeof import('./map-list/map')>()),
  loadMapLibre: () => Promise.reject(new Error('no WebGL')),
}));

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

const button = (text: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};

const key = (target: Element, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

const choice = (multiple: boolean, onAnswer = vi.fn(), onSomethingElse = vi.fn()) =>
  mount(
    <ChoiceCard
      question="Which?"
      options={['A', 'B', 'C']}
      multiple={multiple}
      active
      onAnswer={onAnswer}
      onSomethingElse={onSomethingElse}
      labels={{ send: 'Send', somethingElse: 'Something else' }}
    />,
  );

describe('interactions', () => {
  it('sends a tapped chip', () => {
    const onSelect = vi.fn();
    mount(<FollowUpChips replies={['Yes', 'No']} label="Replies" onSelect={onSelect} />);
    act(() => button('No').click());
    expect(onSelect).toHaveBeenCalledWith('No');
  });

  it('moves focus with arrows and answers only on activation', () => {
    const onAnswer = vi.fn();
    choice(false, onAnswer);
    const a = button('A');
    a.focus();
    key(a, 'ArrowRight');
    expect(document.activeElement).toBe(button('B'));
    expect(button('B').tabIndex).toBe(0);
    expect(onAnswer).not.toHaveBeenCalled();
    act(() => button('B').click());
    expect(onAnswer).toHaveBeenCalledWith('B');
  });

  it('sends several picks in option order', () => {
    const onAnswer = vi.fn();
    choice(true, onAnswer);
    expect(button('Send').disabled).toBe(true);
    act(() => button('C').click());
    act(() => button('A').click());
    expect(button('A').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Send').click());
    expect(onAnswer).toHaveBeenCalledWith('A, C');
  });

  it('hands "Something else" to the app', () => {
    const onSomethingElse = vi.fn();
    choice(false, vi.fn(), onSomethingElse);
    act(() => button('Something else').click());
    expect(onSomethingElse).toHaveBeenCalled();
  });

  it('toggles Save', () => {
    const onToggleSave = vi.fn();
    mount(
      <PlaceCarousel
        places={[place()]}
        saved={new Set()}
        onToggleSave={onToggleSave}
        labels={LABELS}
      />,
    );
    act(() => button('Save').click());
    expect(onToggleSave).toHaveBeenCalledWith('p1', true);
  });

  it('keeps the list when the map cannot load', async () => {
    mount(<PlaceCarousel places={[place()]} saved={new Set()} labels={LABELS} />);
    await act(async () => button('Map').click());
    expect(host.textContent).toContain('The map could not load.');
    expect(host.querySelector('.fv-maplist-list')?.textContent).toContain('Konoba Mala');
    expect(host.querySelector('.fv-maplist-map')).toBeNull();
  });
});
