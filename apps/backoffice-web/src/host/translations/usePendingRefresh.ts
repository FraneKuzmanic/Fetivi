import { useEffect, useRef } from 'react';
import type { Block } from '../../api';

const INTERVAL_MS = 5000;

/** Reloads every 5 s while any block is still translating, so its status updates without a reload. */
export function usePendingRefresh(blocks: readonly Block[], refresh: () => Promise<void>) {
  const pending = blocks.some((b) => b.translation.status === 'pending');
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      // A failed background refresh is ignored; the next tick tries again.
      latest.current().catch(() => {});
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pending]);
}
