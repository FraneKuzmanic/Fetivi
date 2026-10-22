import { BellSimpleRinging } from '@phosphor-icons/react';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getPush, type PushState, recordOffer, saveSubscription } from './push-api';
import { applicationServerKey, canOfferPush } from './support';

interface Push {
  /** Null until known, and always null where push cannot be offered. */
  state: PushState | null;
  /** The offer is spent, whatever the guest chose. */
  spend: () => void;
}

const PushContext = createContext<Push>({ state: null, spend: () => {} });

/**
 * The push offer's state, read once per visit and shared by every place the offer can show.
 * Nothing is asked of the browser here: reading the state is not a prompt.
 */
export function PushProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PushState | null>(null);

  useEffect(() => {
    if (!canOfferPush()) return;
    let live = true;
    getPush().then(
      (next) => {
        if (live) setState(next);
      },
      () => {
        // Offline or the space closed: no offer.
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const value = useMemo<Push>(
    () => ({ state, spend: () => setState((s) => (s ? { ...s, offered: true } : s)) }),
    [state],
  );
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

async function subscribe(publicKey: string): Promise<void> {
  // Only from the guest's tap: the browser prompt never opens on its own (AC #5).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    await recordOffer();
    return;
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  });
  await saveSubscription(subscription.toJSON());
}

/**
 * "Alert me on this phone": shown while the guest waits for news, on Android with push support,
 * only until it has been offered once. Any answer spends the offer.
 */
export function AlertOffer() {
  const { t } = useTranslation();
  const { state, spend } = useContext(PushContext);
  const [busy, setBusy] = useState(false);
  if (!state?.publicKey || state.offered || state.subscribed || !canOfferPush()) return null;
  const publicKey = state.publicKey;

  const onTap = async () => {
    setBusy(true);
    try {
      await subscribe(publicKey);
    } catch {
      // A failed subscribe still spends the offer; the server keeps it if it can.
      await recordOffer().catch(() => {});
    } finally {
      spend();
    }
  };

  return (
    <div className="alert-offer">
      <button type="button" className="text-button" onClick={onTap} disabled={busy}>
        <BellSimpleRinging aria-hidden="true" size={20} weight="bold" />
        {t('push.offer')}
      </button>
      <p className="alert-offer-hint">{t('push.offerHint')}</p>
    </div>
  );
}
