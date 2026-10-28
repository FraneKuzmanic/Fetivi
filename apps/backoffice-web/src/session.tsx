import { backofficeLanguageOf } from '@fetivi/domain/vocabulary';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, auth, type Me } from './api';
import { currentLanguage, setLanguage } from './i18n';
import { storeLanguage } from './i18n/stored-language';

interface SessionValue {
  me: Me | null | 'loading';
  setMe: (me: Me | null) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');

  const refresh = useCallback(async () => {
    try {
      setMe(await auth.me());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setMe(null);
      else throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      // The sign-in page stays in the language the person was using.
      storeLanguage(currentLanguage());
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Signed in, the account's language rules: chosen, or the default from the last sign-in.
  useEffect(() => {
    if (me && me !== 'loading') setLanguage(backofficeLanguageOf(me.account.language));
  }, [me]);

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
