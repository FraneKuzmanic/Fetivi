// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../shell/ConfirmDialog';
import { WithPageTitle } from '../shell/testing';
import { UnitPage } from './UnitPage';
import fixture from './unit-page.fixture.json';

let root: Root | null = null;
let el: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

describe('UnitPage', () => {
  it('names the property once, in the breadcrumb', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/host/units/u1') return json(fixture.unit);
      if (url === '/api/host/units/u1/wizard') return json(fixture.wizard);
      return json({});
    });
    el = document.createElement('div');
    document.body.append(el);
    root = createRoot(el);
    await act(async () => {
      root?.render(
        <ConfirmProvider>
          <WithPageTitle>
            <MemoryRouter initialEntries={['/units/u1']}>
              <Routes>
                <Route path="/units/:id" element={<UnitPage />} />
              </Routes>
            </MemoryRouter>
          </WithPageTitle>
        </ConfirmProvider>,
      );
    });
    await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('A1'));
    expect(el.querySelector('.crumbs a')?.textContent).toBe('Villa 52');
    expect(el.textContent?.split('Villa 52')).toHaveLength(2);
  });
});
