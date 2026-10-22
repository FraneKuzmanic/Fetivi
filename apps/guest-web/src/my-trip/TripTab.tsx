import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { OrdersSection } from './orders/OrdersSection';
import { PlanSection } from './plan/PlanSection';

/** My trip: the day plan and the guest's reservations and orders. */
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
      <PlanSection />
      <OrdersSection />
    </section>
  );
}
