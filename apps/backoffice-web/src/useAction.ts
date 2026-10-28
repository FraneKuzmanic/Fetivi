import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageOf } from './messages';

/** Runs an async action, tracking whether it is busy and the error message it ended with. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  // The error itself, so its message follows a language switch; the subscription below re-renders
  // on that switch.
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  useTranslation('errors');

  // Stable, so callers can list it as an effect dependency.
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (e) {
      setFailure({ error: e });
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error: failure ? messageOf(failure.error) : null, run };
}
