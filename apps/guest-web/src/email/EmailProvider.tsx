import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSpace } from '../space';
import { type EmailState, getEmail } from './email-api';

interface Email {
  /** Null until known. */
  state: EmailState | null;
  /** The Space is closed: nothing can be opted into. */
  closed: boolean;
  /** Reads the state again, e.g. after a booking card gave an email. */
  refresh: () => void;
  set: (state: EmailState) => void;
}

const EmailContext = createContext<Email>({
  state: null,
  closed: true,
  refresh: () => {},
  set: () => {},
});

/** The Space's email state, read once per visit and shared by the offer, the card and Settings. */
export function EmailProvider({ children }: { children: ReactNode }) {
  const { state: space } = useSpace();
  const closed = space.status !== 'ready' || space.space.closed;
  const [state, setState] = useState<EmailState | null>(null);
  const live = useRef(true);

  const refresh = useCallback(() => {
    getEmail().then(
      (next) => {
        if (live.current && next) setState(next);
      },
      () => {
        // Offline: no offer, and the card starts empty.
      },
    );
  }, []);

  useEffect(() => {
    live.current = true;
    refresh();
    return () => {
      live.current = false;
    };
  }, [refresh]);

  const value = useMemo<Email>(
    () => ({ state, closed, refresh, set: setState }),
    [state, closed, refresh],
  );
  return <EmailContext.Provider value={value}>{children}</EmailContext.Provider>;
}

/** Outside the provider: no state, so nothing is offered or prefilled. */
export const useEmail = () => useContext(EmailContext);
