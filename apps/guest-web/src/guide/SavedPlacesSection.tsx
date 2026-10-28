import { PlaceCarousel } from '@fetivi/ui';
import type { PlaceCardPayload } from '@fetivi/ui/payloads';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { placeLabels } from '../chat/render/labels';
import { SavedPlacesProvider, useSavedPlaces } from '../chat/render/SavedPlaces';
import { getSavedPlaceCards } from './guide-api';

type Cards =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; places: PlaceCardPayload[] };

function Carousel({ places }: { places: PlaceCardPayload[] }) {
  const { t, i18n } = useTranslation();
  const saved = useSavedPlaces();
  return (
    <PlaceCarousel
      places={places}
      saved={saved.saved}
      canSave={saved.canSave}
      onToggleSave={saved.toggle}
      labels={placeLabels(t, i18n.language)}
    />
  );
}

/** The Space's saved places as the same cards the chat shows; unsaving works here too. */
export function SavedPlacesSection({ closed }: { closed: boolean }) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<Cards>({ status: 'loading' });

  const load = useCallback(() => {
    setCards({ status: 'loading' });
    getSavedPlaceCards().then(
      (places) => setCards({ status: 'ready', places }),
      () => setCards({ status: 'error' }),
    );
  }, []);

  useEffect(load, [load]);

  if (cards.status === 'loading') return <p className="status">{t('common.loading')}</p>;
  if (cards.status === 'error') {
    return (
      <div className="guide-error">
        <p>{t('guide.loadError')}</p>
        <button type="button" className="button" onClick={load}>
          {t('guide.retry')}
        </button>
      </div>
    );
  }
  if (cards.places.length === 0) return <p>{t('guide.savedEmpty')}</p>;
  return (
    <SavedPlacesProvider closed={closed}>
      <Carousel places={cards.places} />
    </SavedPlacesProvider>
  );
}
