import { backofficeLanguageOf } from '@fetivi/domain/vocabulary';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, auth, type Me } from './api';
import { browserLanguage, setLanguage } from './i18n';

interface SessionValue {
  me: Me | null | 'loading';
  setMe: (me: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setSessionMe] = useState<Me | null | 'loading'>('loading');

  // Signed in, the account's language rules: chosen, or the default from the last sign-in. It is
  // set before the signed-in pages render, so none of them starts in the signed-out language.
  const setMe = useCallback((next: Me | null) => {
    if (next) setLanguage(backofficeLanguageOf(next.account.language));
    setSessionMe(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMe(await auth.me());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMe(null);
      else throw error;
    }
  }, [setMe]);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      // Signed out, the pages speak the browser's language again.
      setLanguage(browserLanguage());
      setMe(null);
    }
  }, [setMe]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ me, setMe, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

/** The session, or null outside a SessionProvider (a component rendered on its own). */
export function useOptionalSession(): SessionValue | null {
  return useContext(SessionContext);
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
