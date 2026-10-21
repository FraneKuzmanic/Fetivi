import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MascotSays } from '../shell/Mascot';
import { OrdersSection } from './orders/OrdersSection';

/** My trip: the plan (ticket 27 fills it) and the guest's reservations and orders. */
export function TripTab() {
  const { t } = useTranslation();
  const heading = useRef<HTMLHeadingElement>(null);

  // Landing on the tab starts reading at its heading.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <section className="trip-tab" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1}>
        {t('tabs.trip')}
      </h1>
      <section className="trip-section" aria-labelledby="trip-plan">
        <h2 id="trip-plan">{t('trip.plan')}</h2>
        <MascotSays>{t('empty.trip')}</MascotSays>
      </section>
      <OrdersSection />
    </section>
  );
}
