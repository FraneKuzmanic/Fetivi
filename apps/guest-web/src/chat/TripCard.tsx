import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { skipTripCard, tripCardSkipped } from './trip-card';

/** One skippable invitation to the About me flow. */
export function TripCard({ storageKey, onStart }: { storageKey: string; onStart: () => void }) {
  const { t } = useTranslation();
  const [skipped, setSkipped] = useState(() => tripCardSkipped(storageKey));
  if (skipped) return null;
  return (
    <section className="trip-card" aria-labelledby="trip-card-title">
      <h2 id="trip-card-title">{t('chat.tripTitle')}</h2>
      <p>{t('chat.tripBody')}</p>
      <div className="trip-card-actions">
        <button type="button" className="button" onClick={onStart}>
          {t('chat.tripStart')}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            skipTripCard(storageKey);
            setSkipped(true);
            // The button is about to go: keep the reading position at the top of the tab.
            document.getElementById('tab-title')?.focus();
          }}
        >
          {t('chat.tripSkip')}
        </button>
      </div>
    </section>
  );
}
