import { useCallback, useState } from 'react';
import { messageOf } from './messages';

/** Runs an async action, tracking whether it is busy and the error message it ended with. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable, so callers can list it as an effect dependency.
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run };
}
