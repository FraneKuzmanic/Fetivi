import type { TranslationStatus } from '@fetivi/domain/vocabulary';
import { useEffect, useRef } from 'react';

const INTERVAL_MS = 5000;

/** Reloads every 5 s while any item is still translating, so its status updates without a reload. */
export function usePendingRefresh(
  blocks: readonly { translation: { status: TranslationStatus } }[],
  refresh: () => Promise<void>,
) {
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
