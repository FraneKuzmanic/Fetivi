import { ChatCircleText } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { MascotSays } from '../shell/Mascot';
import { useSpace } from '../space';
import { OrdersSection } from './orders/OrdersSection';
import { PlanSection } from './plan/PlanSection';

/**
 * My trip: the day plan and the guest's reservations and orders. While both are empty Fetivi says
 * once, at the top, how they fill up; each section then shows only a quiet empty line.
 */
export function TripTab() {
  const { t } = useTranslation();
  const { state: space } = useSpace();
  const heading = useRef<HTMLHeadingElement>(null);
  const [empty, setEmpty] = useState({ plan: false, orders: false });
  // After checkout the chat is closed, so there is nobody to ask.
  const closed = space.status !== 'ready' || space.space.closed;

  // Landing on the tab starts reading at its heading.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const planEmpty = useCallback((plan: boolean) => setEmpty((e) => ({ ...e, plan })), []);
  const ordersEmpty = useCallback((orders: boolean) => setEmpty((e) => ({ ...e, orders })), []);

  return (
    <section className="trip-tab" aria-labelledby="tab-title">
      <h1 id="tab-title" ref={heading} tabIndex={-1}>
        {t('tabs.trip')}
      </h1>
      {empty.plan && empty.orders && !closed && (
        <div className="trip-welcome">
          <MascotSays>{t('trip.empty')}</MascotSays>
          <Link to="/chat" className="button trip-welcome-action">
            <ChatCircleText aria-hidden="true" weight="bold" />
            {t('trip.emptyAction')}
          </Link>
        </div>
      )}
      <PlanSection onEmpty={planEmpty} />
      <OrdersSection onEmpty={ordersEmpty} />
    </section>
  );
}
