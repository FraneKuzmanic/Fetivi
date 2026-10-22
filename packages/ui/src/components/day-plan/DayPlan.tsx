import type { OrderStatus } from '@fetivi/domain/order-vocabulary';
import { ChatCircleDots, Ticket } from '@phosphor-icons/react';
import { useId } from 'react';
import type { DayPlanPayload, PlanItemPayload } from '../../payloads';
import { ORDER_TONE, Status } from '../receipt-card/ReceiptCard';

/** Every visible string of the day plan; the app translates them. */
export interface DayPlanLabels {
  /** "Tuesday 15 July", given a civil date. */
  day: (date: string) => string;
  today: string;
  anyTime: string;
  nothingPlanned: string;
  booked: string;
  orderStatus: (status: OrderStatus) => string;
  /** The Ask button's accessible name: "Ask Fetivi about Blue Lagoon boat trip". */
  ask: (title: string) => string;
  askShort: string;
  plan: string;
}

type PlanDayPayload = DayPlanPayload['days'][number];

/** Timed items in time order, then the "any time" ones; the store already sorts, this keeps it so. */
const ordered = (items: PlanItemPayload[]) => [
  ...items
    .filter((i) => i.time !== null)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
  ...items.filter((i) => i.time === null),
];

/** The day plan timeline: one block per Stay day, in chat and in My trip → Plan. */
export function DayPlan({
  days,
  today,
  labels,
  onAsk,
  showEmptyDays = true,
}: {
  days: DayPlanPayload['days'];
  today: string;
  labels: DayPlanLabels;
  /** Without it the items have no Ask button. */
  onAsk?: (item: PlanItemPayload) => void;
  showEmptyDays?: boolean;
}) {
  const shown = showEmptyDays ? days : days.filter((d) => d.items.length > 0);
  return (
    <section className="fv-plan" aria-label={labels.plan}>
      {shown.map((day) => (
        <PlanDay
          key={day.date}
          day={day}
          isToday={day.date === today}
          labels={labels}
          onAsk={onAsk}
        />
      ))}
    </section>
  );
}

function PlanDay({
  day,
  isToday,
  labels,
  onAsk,
}: {
  day: PlanDayPayload;
  isToday: boolean;
  labels: DayPlanLabels;
  onAsk?: (item: PlanItemPayload) => void;
}) {
  const headingId = useId();
  const items = ordered(day.items);
  const firstUntimed = items.findIndex((i) => i.time === null);
  return (
    <section className="fv-plan-day" aria-labelledby={headingId} data-today={isToday || undefined}>
      <h3 id={headingId} className="fv-plan-heading">
        {labels.day(day.date)}
        {isToday && <span className="fv-plan-today">{labels.today}</span>}
      </h3>
      {items.length === 0 ? (
        <p className="fv-plan-empty">{labels.nothingPlanned}</p>
      ) : (
        <ol className="fv-plan-items">
          {items.map((item, index) => (
            <li key={item.id} className="fv-plan-item" data-kind={item.kind}>
              <span className="fv-plan-time">
                {item.time !== null ? (
                  <time dateTime={item.time}>{item.time}</time>
                ) : (
                  index === firstUntimed && labels.anyTime
                )}
              </span>
              <span className="fv-plan-dot" aria-hidden="true" />
              <div className="fv-plan-body">
                <p className="fv-plan-title">{item.title}</p>
                {item.note && <p className="fv-plan-note">{item.note}</p>}
                {item.kind === 'order' && (
                  <p className="fv-plan-booked">
                    <span className="fv-plan-booked-tag">
                      <Ticket size={16} aria-hidden="true" />
                      {labels.booked}
                    </span>
                    {item.orderStatus && (
                      <Status
                        tone={ORDER_TONE[item.orderStatus]}
                        text={labels.orderStatus(item.orderStatus)}
                      />
                    )}
                  </p>
                )}
                {onAsk && (
                  <button
                    type="button"
                    className="fv-plan-ask"
                    aria-label={labels.ask(item.title)}
                    onClick={() => onAsk(item)}
                  >
                    <ChatCircleDots size={18} aria-hidden="true" />
                    {labels.askShort}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
