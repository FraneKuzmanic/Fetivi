import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { skipTripCard, tripCardSkipped } from './trip-card';

/** One skippable invitation to talk about the trip; Start only sends a message for now. */
export function TripCard({
  storageKey,
  onSend,
}: {
  storageKey: string;
  onSend: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [skipped, setSkipped] = useState(() => tripCardSkipped(storageKey));
  if (skipped) return null;
  return (
    <section className="trip-card" aria-labelledby="trip-card-title">
      <h2 id="trip-card-title">{t('chat.tripTitle')}</h2>
      <p>{t('chat.tripBody')}</p>
      <div className="trip-card-actions">
        <button type="button" className="button" onClick={() => onSend(t('chat.tripMessage'))}>
          {t('chat.tripStart')}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            skipTripCard(storageKey);
            setSkipped(true);
          }}
        >
          {t('chat.tripSkip')}
        </button>
      </div>
    </section>
  );
}
