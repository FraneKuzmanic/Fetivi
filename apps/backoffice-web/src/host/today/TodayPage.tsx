import {
  ArrowsLeftRight,
  BellSimple,
  Buildings,
  CalendarBlank,
  CalendarCheck,
  CalendarPlus,
  CaretLeft,
  CaretRight,
  ChatCircleText,
  CheckCircle,
  DoorOpen,
  type Icon,
  Key,
  Lightbulb,
  ListChecks,
  Plus,
  Receipt,
  SealCheck,
  SuitcaseRolling,
  UsersThree,
} from '@phosphor-icons/react';
import { Fragment, type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { host, type PropertySummary, type Stay } from '../../api';
import { HarbourHouse } from '../../auth/HarbourHouse';
import { addDays, todayIso } from '../../forms/datetime';
import { i18next, localeOf } from '../../i18n';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { guestsLabel, nightsLabel } from '../stays/format';

/** How far ahead the arrivals list looks. */
const AHEAD_DAYS = 14;

interface TodayData {
  properties: PropertySummary[];
  stays: Stay[];
  unread: number;
  ordersWaiting: number;
  proposals: number;
  suggestions: number;
}

interface Attention {
  key: string;
  icon: Icon;
  text: string;
  to: string;
  action: string;
}

const t = i18next.getFixedT(null, 'host', 'today');

const civil = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dayName = (iso: string) =>
  civil(iso).toLocaleDateString(localeOf(i18next.language), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

/** "Today", "Tomorrow", or "Thursday 29 October". */
export function dayHeading(iso: string, today: string): string {
  if (iso === today) return t('title');
  if (iso === addDays(today, 1)) return t('tomorrow');
  return dayName(iso);
}

/** The PIN reminder, with the arrival day in the sentence. */
function pinText(unit: string, checkIn: string, today: string): string {
  if (checkIn === today) return t('pinToday', { unit });
  if (checkIn === addDays(today, 1)) return t('pinTomorrow', { unit });
  return t('pinOn', { unit, day: dayName(checkIn) });
}

/** Everything that waits on the host, most pressing first. */
export function attentionItems(data: TodayData): Attention[] {
  const items: Attention[] = [];
  if (data.unread > 0) {
    items.push({
      key: 'messages',
      icon: ChatCircleText,
      text: t('unread', { count: data.unread }),
      to: '/inbox',
      action: t('openInbox'),
    });
  }
  if (data.ordersWaiting > 0) {
    items.push({
      key: 'orders',
      icon: Receipt,
      text: t('ordersWaiting', { count: data.ordersWaiting }),
      to: '/inbox',
      action: t('answer'),
    });
  }
  for (const stay of data.stays.filter((s) => s.pinWarning)) {
    items.push({
      key: `pin-${stay.id}`,
      icon: Key,
      text: pinText(stay.unitName, stay.checkIn, todayIso()),
      to: `/stays/${stay.id}`,
      action: t('sendPin'),
    });
  }
  if (data.proposals > 0) {
    items.push({
      key: 'proposals',
      icon: CalendarPlus,
      text: t('proposals', { count: data.proposals }),
      to: '/stays',
      action: t('review'),
    });
  }
  for (const p of data.properties) {
    if (!p.approved) {
      items.push({
        key: `approval-${p.id}`,
        icon: SealCheck,
        text: t('awaitingApproval', { property: p.name }),
        to: `/properties/${p.id}`,
        action: t('view'),
      });
      continue;
    }
    for (const u of p.units.filter((unit) => !unit.live)) {
      items.push({
        key: `setup-${u.id}`,
        icon: ListChecks,
        text: t('finishSetup', { unit: u.name }),
        to: `/units/${u.id}/setup`,
        action: t('continueSetup'),
      });
    }
  }
  if (data.suggestions > 0) {
    items.push({
      key: 'suggestions',
      icon: Lightbulb,
      text: t('suggestions', { count: data.suggestions }),
      to: '/suggestions',
      action: t('seeWhat'),
    });
  }
  return items;
}

interface Movement {
  stay: Stay;
  kind: 'arrival' | 'departure';
  date: string;
}

/** Arrivals and departures from today on, grouped by day. */
export function movementsByDay(stays: Stay[], today: string): [string, Movement[]][] {
  const until = addDays(today, AHEAD_DAYS - 1);
  const within = (d: string) => d >= today && d <= until;
  const all: Movement[] = [
    ...stays
      .filter((s) => within(s.checkout))
      .map((s) => ({ stay: s, kind: 'departure' as const, date: s.checkout })),
    ...stays
      .filter((s) => within(s.checkIn))
      .map((s) => ({ stay: s, kind: 'arrival' as const, date: s.checkIn })),
  ];
  const days = new Map<string, Movement[]>();
  for (const m of all.sort((a, b) => a.date.localeCompare(b.date))) {
    days.set(m.date, [...(days.get(m.date) ?? []), m]);
  }
  return [...days.entries()];
}

function MovementRow({ movement }: { movement: Movement }) {
  const { stay, kind } = movement;
  useTranslation(['host', 'common']);
  const Glyph = kind === 'arrival' ? SuitcaseRolling : DoorOpen;
  return (
    <li>
      <Link to={`/stays/${stay.id}`} className="row-link movement">
        <span className={`movement-icon ${kind}`} aria-hidden="true">
          <Glyph />
        </span>
        <span className="block-text">
          <strong>
            {kind === 'arrival'
              ? t('arrival', { unit: stay.unitName })
              : t('departure', { unit: stay.unitName })}
          </strong>
          <span className="muted">
            {[
              guestsLabel(stay.partySize),
              nightsLabel(stay.checkIn, stay.checkout),
              stay.bookerName,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {kind === 'arrival' ? (
          stay.pinSentAt ? (
            <span className="chip ok">{t('pinSent')}</span>
          ) : (
            <span className="chip wait">{t('pinNotSent')}</span>
          )
        ) : (
          <span />
        )}
        <CaretRight className="row-caret" aria-hidden="true" />
      </Link>
    </li>
  );
}

/** How many days the calendar shows at once: two Monday-first weeks. */
const CALENDAR_DAYS = 14;

const shortDate = (iso: string, withYear = false) =>
  civil(iso).toLocaleDateString(localeOf(i18next.language), {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

/** The days the calendar shows: two weeks from the Monday of today's week, moved by `weeks`. */
export function calendarDays(today: string, weeks: number): string[] {
  const monday = addDays(today, -((civil(today).getUTCDay() + 6) % 7) + weeks * 7);
  return Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(monday, i));
}

/**
 * Where a Stay's bar sits among the shown days, as half-day grid columns (day i is columns
 * 2 + 2i and 3 + 2i), so a bar runs from midday of check-in to midday of checkout. Null when the
 * Stay has no night on screen. `cutStart`/`cutEnd` mark a Stay that runs on past the edge.
 */
export function barSpan(
  stay: Pick<Stay, 'checkIn' | 'checkout'>,
  days: string[],
): { start: number; end: number; cutStart: boolean; cutEnd: boolean } | null {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last || stay.checkout <= first || stay.checkIn > last) return null;
  const cutStart = stay.checkIn < first;
  const cutEnd = stay.checkout > last;
  return {
    start: cutStart ? 2 : 2 + days.indexOf(stay.checkIn) * 2 + 1,
    end: cutEnd ? 2 + days.length * 2 : 2 + days.indexOf(stay.checkout) * 2 + 1,
    cutStart,
    cutEnd,
  };
}

/** Units down, days across, each Stay a bar over its nights; two weeks at a time. */
function StayCalendar({
  units,
  stays,
  today,
}: {
  units: { id: string; name: string }[];
  stays: Stay[];
  today: string;
}) {
  useTranslation(['host', 'common']);
  const [weeks, setWeeks] = useState(0);
  const days = calendarDays(today, weeks);
  const first = days[0] ?? today;
  const last = days[days.length - 1] ?? today;
  const range =
    first.slice(0, 4) === last.slice(0, 4)
      ? `${shortDate(first)} – ${shortDate(last, true)}`
      : `${shortDate(first, true)} – ${shortDate(last, true)}`;
  const rows = units.length + 1;

  return (
    <section className="today-section" aria-labelledby="calendar">
      <div className="staycal-head">
        <SectionTitle id="calendar" icon={CalendarBlank}>
          {t('calendar')}
        </SectionTitle>
        <div className="staycal-nav">
          <span className="staycal-range" aria-live="polite">
            {range}
          </span>
          <button
            type="button"
            className="staycal-today"
            disabled={weeks === 0}
            onClick={() => setWeeks(0)}
          >
            {t('title')}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('earlierWeeks')}
            onClick={() => setWeeks((w) => w - 1)}
          >
            <CaretLeft aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={t('laterWeeks')}
            onClick={() => setWeeks((w) => w + 1)}
          >
            <CaretRight aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="staycal-scroll">
        <div
          className="staycal"
          style={{ gridTemplateColumns: `var(--staycal-unit) repeat(${CALENDAR_DAYS * 2}, 1fr)` }}
        >
          <span className="staycal-corner" />
          {days.map((d, i) => {
            const weekday = civil(d).getUTCDay();
            const classes = [
              'staycal-col',
              weekday === 0 || weekday === 6 ? 'is-weekend' : '',
              d === today ? 'is-today' : '',
              d < today ? 'is-past' : '',
              d.endsWith('-01') ? 'is-month-start' : '',
            ].filter(Boolean);
            const column = `${2 + i * 2} / span 2`;
            return (
              <Fragment key={d}>
                <span
                  className={classes.join(' ')}
                  style={{ gridRow: `1 / ${rows + 1}`, gridColumn: column }}
                />
                <span
                  className={d === today ? 'staycal-day is-today' : 'staycal-day'}
                  style={{ gridRow: 1, gridColumn: column }}
                >
                  <span>
                    {civil(d).toLocaleDateString(localeOf(i18next.language), {
                      weekday: 'short',
                      timeZone: 'UTC',
                    })}
                  </span>
                  <strong>{Number(d.slice(8))}</strong>
                </span>
              </Fragment>
            );
          })}
          {units.map((u, row) => (
            <div key={u.id} className="staycal-row">
              <span className="staycal-unit" style={{ gridRow: row + 2 }}>
                <span>{u.name}</span>
              </span>
              {stays
                .filter((s) => s.unitId === u.id)
                .map((s) => {
                  const span = barSpan(s, days);
                  if (!span) return null;
                  const name = s.bookerName ?? guestsLabel(s.partySize);
                  return (
                    <Link
                      key={s.id}
                      to={`/stays/${s.id}`}
                      className={[
                        'staycal-bar',
                        span.cutStart ? 'cut-start' : '',
                        span.cutEnd ? 'cut-end' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{ gridRow: row + 2, gridColumn: `${span.start} / ${span.end}` }}
                      aria-label={t('bar', {
                        name,
                        unit: u.name,
                        from: shortDate(s.checkIn),
                        to: shortDate(s.checkout),
                        guests: guestsLabel(s.partySize),
                      })}
                    >
                      {name}
                    </Link>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** A Today section heading with its icon. */
function SectionTitle({
  id,
  icon: Glyph,
  children,
}: {
  id: string;
  icon: Icon;
  children: ReactNode;
}) {
  return (
    <h2 id={id} className="section-title">
      <Glyph className="section-icon" aria-hidden="true" />
      {children}
    </h2>
  );
}

export function TodayPage() {
  useTranslation(['host', 'common']);
  const { t: tc } = useTranslation();
  const { error, run } = useAction();
  const [data, setData] = useState<TodayData | null>(null);
  const today = todayIso();

  useEffect(() => {
    void run(async () => {
      const [properties, stays, inbox, proposals, suggestions] = await Promise.all([
        host.properties(),
        host.stays(),
        host.inbox(),
        host.stayProposals(),
        host.suggestions(),
      ]);
      setData({
        properties: properties.properties,
        stays: stays.stays,
        unread: inbox.unread,
        ordersWaiting: inbox.ordersWaiting,
        proposals: proposals.proposals.length,
        suggestions: suggestions.suggestions.length,
      });
    });
  }, [run]);

  const attention = data ? attentionItems(data) : [];
  const days = data ? movementsByDay(data.stays, today) : [];
  const inStay = data?.stays.filter((s) => s.phase === 'in_stay') ?? [];
  const units = data?.properties.flatMap((p) => p.units.map((u) => ({ ...u, property: p }))) ?? [];

  usePageTitle(t('title'));

  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {data === null && !error ? <p className="muted">{tc('loading')}</p> : null}

      {data ? (
        data.properties.length === 0 ? (
          <EmptyState
            art={<HarbourHouse className="empty-art" />}
            title={t('emptyTitle')}
            action={
              <Link className="button primary" to="/properties/new">
                <Plus aria-hidden="true" weight="bold" />
                {t('addProperty')}
              </Link>
            }
          >
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <div className="today">
            <div className="today-main">
              <section className="today-section" aria-labelledby="attention">
                <SectionTitle id="attention" icon={BellSimple}>
                  {t('attention')}
                </SectionTitle>
                {attention.length > 0 ? (
                  <ul className="rows">
                    {attention.map((a) => (
                      <li key={a.key}>
                        <Link to={a.to} className="row-link attention-row">
                          <a.icon className="attention-icon" aria-hidden="true" />
                          <span>{a.text}</span>
                          <span className="attention-action">{a.action}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="all-clear">
                    <CheckCircle className="all-clear-icon" aria-hidden="true" weight="fill" />
                    {t('allClear')}
                  </p>
                )}
              </section>

              {units.length > 0 ? (
                <StayCalendar units={units} stays={data.stays} today={today} />
              ) : null}

              <section className="today-section" aria-labelledby="movements">
                <SectionTitle id="movements" icon={ArrowsLeftRight}>
                  {t('movements')}
                </SectionTitle>
                {days.length > 0 ? (
                  <div className="day-groups">
                    {days.map(([day, movements]) => (
                      <div key={day} className="day-group">
                        <h3 className="day-heading">{dayHeading(day, today)}</h3>
                        <ul className="rows">
                          {movements.map((m) => (
                            <MovementRow key={`${m.kind}-${m.stay.id}`} movement={m} />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={SuitcaseRolling} title={t('noArrivals', { count: AHEAD_DAYS })}>
                    {t('noArrivalsBody')}
                  </EmptyState>
                )}
              </section>
            </div>

            <aside className="today-aside" aria-label={t('yourUnits')}>
              <section className="today-section" aria-labelledby="units">
                <SectionTitle id="units" icon={Buildings}>
                  {t('yourUnits')}
                </SectionTitle>
                <ul className="rows">
                  {units.map((u) => (
                    <li key={u.id}>
                      <Link to={`/units/${u.id}`} className="row-link unit-row">
                        <span className="block-text">
                          <span className="title-line">
                            <strong>{u.name}</strong>
                            {!u.property.approved ? (
                              <span className="chip wait">{t('awaitingApprovalChip')}</span>
                            ) : u.live ? (
                              <span className="chip ok">{t('live')}</span>
                            ) : (
                              <span className="chip neutral">{t('settingUp')}</span>
                            )}
                          </span>
                          <span className="muted">{u.property.name}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
              <dl className="today-facts">
                <div>
                  <dt>{t('inStayNow')}</dt>
                  <dd>
                    <UsersThree className="fact-icon" aria-hidden="true" />
                    {inStay.reduce((n, s) => n + s.partySize, 0)}
                  </dd>
                </div>
                <div>
                  <dt>{t('upcoming')}</dt>
                  <dd>
                    <CalendarCheck className="fact-icon" aria-hidden="true" />
                    {data.stays.filter((s) => s.phase === 'upcoming').length}
                  </dd>
                </div>
              </dl>
            </aside>
          </div>
        )
      ) : null}
    </>
  );
}
