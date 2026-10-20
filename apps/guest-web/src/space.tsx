import type { GuestLanguage } from '@fetivi/domain/vocabulary';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, getSpace, type Space, setSpaceLanguage } from './api';
import { setLanguage } from './i18n';
import { isLanguage } from './i18n/browser-language';

export type SpaceState =
  | { status: 'loading' }
  | { status: 'none' }
  /** Loading the space failed for a reason other than "no space": the device may still have one. */
  | { status: 'offline' }
  | { status: 'ready'; space: Space };

/** What the unit link `/u/:slug` shows: the shell only for a space of that same unit. */
export function entryDecision(state: SpaceState, slug: string): 'loading' | 'shell' | 'access' {
  if (state.status === 'loading') return 'loading';
  return state.status === 'ready' && state.space.unitSlug === slug ? 'shell' : 'access';
}

/** What a tab route shows: nothing beyond the "open your link" screen without a space. */
export function guardDecision(state: SpaceState): 'loading' | 'allow' | 'no-link' | 'offline' {
  if (state.status === 'loading' || state.status === 'offline') return state.status;
  return state.status === 'ready' ? 'allow' : 'no-link';
}

const STORED_LANGUAGE = 'fetivi.language';

/** The language picked before a space exists. A convenience only; storage may be unavailable. */
export function storedLanguage(): GuestLanguage | null {
  try {
    const value = localStorage.getItem(STORED_LANGUAGE);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeLanguage(language: GuestLanguage): void {
  try {
    localStorage.setItem(STORED_LANGUAGE, language);
  } catch {
    // Private mode or blocked storage: the choice lives for this page only.
  }
}

interface SpaceContextValue {
  state: SpaceState;
  setSpace: (space: Space) => void;
  /** Switches the interface now and stores the choice on the space when there is one. Never throws. */
  changeLanguage: (language: GuestLanguage) => Promise<void>;
}

const SpaceContext = createContext<SpaceContextValue | null>(null);

export function SpaceProvider({
  initial = { status: 'loading' },
  children,
}: {
  /** Tests start from a known state; the app loads the space. */
  initial?: SpaceState;
  children: ReactNode;
}) {
  const [state, setState] = useState<SpaceState>(initial);

  useEffect(() => {
    if (initial.status !== 'loading') return;
    let live = true;
    getSpace().then(
      (space) => {
        if (live) setState({ status: 'ready', space });
      },
      (error: unknown) => {
        // 401 is the server saying "no space"; anything else leaves the question open.
        const none = error instanceof ApiError && error.status === 401;
        if (live) setState({ status: none ? 'none' : 'offline' });
      },
    );
    return () => {
      live = false;
    };
  }, [initial.status]);

  const setSpace = useCallback((space: Space) => setState({ status: 'ready', space }), []);

  const changeLanguage = useCallback(
    async (next: GuestLanguage) => {
      setLanguage(next);
      if (state.status !== 'ready') {
        storeLanguage(next);
        return;
      }
      try {
        setState({ status: 'ready', space: await setSpaceLanguage(next) });
      } catch {
        // The switch holds on this page; the space keeps its old language until a later change.
      }
    },
    [state.status],
  );

  return (
    <SpaceContext.Provider value={{ state, setSpace, changeLanguage }}>
      {children}
    </SpaceContext.Provider>
  );
}

export function useSpace(): SpaceContextValue {
  const value = useContext(SpaceContext);
  if (!value) throw new Error('useSpace outside SpaceProvider');
  return value;
}
