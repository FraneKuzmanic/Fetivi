import { DayPlan } from '@fetivi/ui';
import type { DayPlanPayload, PlanItemPayload } from '@fetivi/ui/payloads';
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

/** My trip → Plan: read-only; changes happen in chat, and "Ask Fetivi" takes an item there. */
export function PlanSection() {
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

  const ask = (item: PlanItemPayload) =>
    navigate('/chat', {
      state: { ask: t('trip.askText', { title: item.title, day: labels.day(item.date) }) },
    });

  return (
    <section className="trip-section" aria-labelledby="trip-plan">
      <h2 id="trip-plan">{t('trip.plan')}</h2>
      {plan.status === 'loading' ? (
        <p className="status">{t('common.loading')}</p>
      ) : plan.status === 'offline' ? (
        <div className="trip-offline">
          <MascotSays>{t('error.network')}</MascotSays>
          <button type="button" className="button" onClick={load}>
            {t('chat.retry')}
          </button>
        </div>
      ) : plan.plan.days.every((d) => d.items.length === 0) ? (
        <MascotSays>{t('trip.noPlan')}</MascotSays>
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
