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
import { getInbox, type HandoffStatus, type InboxState, markInboxSeen } from './inbox-api';

/** How often the inbox is checked while the app is visible; a push also triggers a check. */
const POLL_MS = 60_000;

export interface Inbox {
  unread: number;
  /** A sent Host message's state; null when unknown. */
  status: (handoffId: string) => HandoffStatus | null;
  /** Grows each time the unread count grows, so the Chat can reload its history. */
  version: number;
  refresh: () => Promise<void>;
  markSeen: () => Promise<void>;
}

const noop = async () => {};
const InboxContext = createContext<Inbox>({
  unread: 0,
  status: () => null,
  version: 0,
  refresh: noop,
  markSeen: noop,
});

export const useInbox = () => useContext(InboxContext);

/**
 * Polls the guest's inbox: on mount, every minute while the app is visible, when it comes back
 * into view, and when the service worker receives a push. Errors are silent: the badge stays as
 * it was.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InboxState | null>(null);
  const [version, setVersion] = useState(0);
  const lastUnread = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getInbox();
      if (lastUnread.current !== null && next.unread > lastUnread.current) {
        setVersion((v) => v + 1);
      }
      lastUnread.current = next.unread;
      setState(next);
    } catch {
      // Offline or the space closed: keep what is shown.
    }
  }, []);

  const markSeen = useCallback(async () => {
    try {
      await markInboxSeen();
      lastUnread.current = 0;
      setState((s) => (s ? { ...s, unread: 0 } : s));
    } catch {
      // The badge stays until the next check.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const visible = () => document.visibilityState === 'visible';
    const timer = window.setInterval(() => {
      if (visible()) void refresh();
    }, POLL_MS);
    const onShow = () => {
      if (visible()) void refresh();
    };
    const onPush = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === 'fetivi-inbox') void refresh();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    navigator.serviceWorker?.addEventListener('message', onPush);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
      navigator.serviceWorker?.removeEventListener('message', onPush);
    };
  }, [refresh]);

  const value = useMemo<Inbox>(
    () => ({
      unread: state?.unread ?? 0,
      status: (id) => state?.handoffs.find((h) => h.id === id)?.status ?? null,
      version,
      refresh,
      markSeen,
    }),
    [state, version, refresh, markSeen],
  );
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}
