import type { GuestProjection } from '@fetivi/domain/projection-types';
import { useCallback, useEffect, useState } from 'react';
import { useSpace } from '../space';
import { getUnit } from './guide-api';

export type UnitState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; unit: GuestProjection };

/**
 * The unit record, loaded on mount and again when the Space's language changes (the server
 * answers in it). A response that arrives after a newer request started is dropped.
 */
export function useUnit(): { state: UnitState; reload: () => void } {
  const { state: space } = useSpace();
  const language = space.status === 'ready' ? space.space.language : null;
  const [state, setState] = useState<UnitState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the language and a retry are the reload triggers.
  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    getUnit().then(
      (unit) => current && setState({ status: 'ready', unit }),
      () => current && setState({ status: 'error' }),
    );
    return () => {
      current = false;
    };
  }, [language, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
