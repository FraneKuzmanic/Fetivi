import { DayPlan } from '@fetivi/ui';
import type { DayPlanPayload, PlanItemPayload } from '@fetivi/ui/payloads';
import { CalendarDots } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { planLabels } from '../../chat/render/labels';
import { MascotSays } from '../../shell/Mascot';
import { useSpace } from '../../space';
import { getPlan } from './plan-api';

type PlanState =
  | { status: 'loading' }
  | { status: 'offline' }
  | { status: 'ready'; plan: DayPlanPayload };

/**
 * My trip → Plan: read-only; changes happen in chat, and "Ask Fetivi" takes an item there.
 * `onEmpty` tells My trip whether the plan has nothing on it.
 */
export function PlanSection({ onEmpty }: { onEmpty: (empty: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { state: space } = useSpace();
  const [plan, setPlan] = useState<PlanState>({ status: 'loading' });
  // After checkout the chat is closed, so there is nobody to ask.
  const closed = space.status !== 'ready' || space.space.closed;
  const labels = planLabels(t, i18n.language);

  const load = useCallback(() => {
    setPlan({ status: 'loading' });
    getPlan().then(
      // The server checks the plan against the timeline's schema before it answers.
      (body) => setPlan({ status: 'ready', plan: body.plan }),
      () => setPlan({ status: 'offline' }),
    );
  }, []);

  useEffect(load, [load]);

  const isEmpty = plan.status === 'ready' && plan.plan.days.every((d) => d.items.length === 0);
  useEffect(() => onEmpty(isEmpty), [isEmpty, onEmpty]);

  const ask = (item: PlanItemPayload) =>
    navigate('/chat', {
      state: { ask: t('trip.askText', { title: item.title, day: labels.day(item.date) }) },
    });

  return (
    <section className="trip-section" aria-labelledby="trip-plan">
      <h2 id="trip-plan" className="trip-heading">
        <span className="trip-heading-icon">
          <CalendarDots aria-hidden="true" />
        </span>
        {t('trip.plan')}
      </h2>
      {plan.status === 'loading' ? (
        <p className="status">{t('common.loading')}</p>
      ) : plan.status === 'offline' ? (
        <div className="trip-offline">
          <MascotSays>{t('error.network')}</MascotSays>
          <button type="button" className="button" onClick={load}>
            {t('chat.retry')}
          </button>
        </div>
      ) : isEmpty ? (
        <p className="trip-empty">{t('trip.nothingPlanned')}</p>
      ) : (
        <DayPlan
          days={plan.plan.days}
          today={plan.plan.today}
          labels={labels}
          onAsk={closed ? undefined : ask}
        />
      )}
    </section>
  );
}
