import { PlaceCarousel } from '@fetivi/ui';
import type { PlaceCardPayload } from '@fetivi/ui/payloads';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { placeLabels } from '../chat/render/labels';
import { SavedPlacesProvider, useSavedPlaces } from '../chat/render/SavedPlaces';
import { MascotSays } from '../shell/Mascot';
import { getHostPickCards } from './guide-api';

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

/**
 * Host's top picks: the host's picks and added places as cards (picks can be saved; host-added
 * cards hide Save), then the host's Neighbourhood tips blocks.
 */
export function HostPicksSection({ closed, tips }: { closed: boolean; tips: ReactNode | null }) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<Cards>({ status: 'loading' });

  const load = useCallback(() => {
    setCards({ status: 'loading' });
    getHostPickCards().then(
      (places) => setCards({ status: 'ready', places }),
      () => setCards({ status: 'error' }),
    );
  }, []);

  useEffect(load, [load]);

  if (cards.status === 'loading') return <p className="status">{t('common.loading')}</p>;
  if (cards.status === 'ready' && cards.places.length === 0 && !tips) {
    return <MascotSays>{t('guide.picksEmpty')}</MascotSays>;
  }
  return (
    <>
      {cards.status === 'error' ? (
        <div className="guide-error">
          <MascotSays>{t('guide.loadError')}</MascotSays>
          <button type="button" className="button" onClick={load}>
            {t('guide.retry')}
          </button>
        </div>
      ) : cards.places.length > 0 ? (
        <SavedPlacesProvider closed={closed}>
          <Carousel places={cards.places} />
        </SavedPlacesProvider>
      ) : null}
      {tips ? (
        <section className="guide-tips" aria-labelledby="guide-tips-heading">
          <h2 id="guide-tips-heading">{t('guide.tipsHeading')}</h2>
          {tips}
        </section>
      ) : null}
    </>
  );
}
