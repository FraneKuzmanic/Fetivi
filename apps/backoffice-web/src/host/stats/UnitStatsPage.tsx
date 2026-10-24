import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  type AnswerTotals,
  host,
  type TopicCount,
  type UnitDetail,
  type UnitStats,
} from '../../api';
import { ANSWER_TOPIC_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
import { dateRange } from '../stays/format';

/** Thumbs up over rated answers (43); "—" before any answer is rated. */
export function thumbsRatio(up: number, down: number): string {
  return up + down === 0 ? '—' : `${Math.round((up / (up + down)) * 100)}%`;
}

/** Conversations, answers and the helpful share as plain labelled figures, one row. */
export function Figures({ totals }: { totals: AnswerTotals }) {
  return (
    <dl className="figures">
      <div>
        <dt>Conversations</dt>
        <dd>{totals.conversations}</dd>
      </div>
      <div>
        <dt>Answers</dt>
        <dd>{totals.answers}</dd>
      </div>
      <div>
        <dt>Helpful</dt>
        <dd>
          {thumbsRatio(totals.up, totals.down)}
          <span className="figure-note">
            {totals.up} up · {totals.down} down
          </span>
        </dd>
      </div>
    </dl>
  );
}

/** What answers were about, most asked first, with a bar for scanning. */
export function TopTopics({ topics }: { topics: TopicCount[] }) {
  const headingId = useId();
  const max = Math.max(1, ...topics.map((t) => t.count));
  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId}>Top topics</h2>
      {topics.length > 0 ? (
        <ol className="topic-list">
          {topics.map((t) => (
            <li key={t.topic} className="topic-row">
              <span className="topic-name">{ANSWER_TOPIC_LABELS[t.topic]}</span>
              <span className="topic-count">{t.count}</span>
              <span className="topic-bar" aria-hidden="true">
                <span style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No answers yet.</p>
      )}
    </section>
  );
}

/** A unit's guest stats (43 AC 3): counts and topics only, never what guests wrote. */
export function UnitStatsPage() {
  const { id = '' } = useParams();
  const { error, run } = useAction();
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [stats, setStats] = useState<UnitStats | null>(null);
  const staysId = useId();

  useEffect(() => {
    void run(async () => {
      const [detail, numbers] = await Promise.all([host.unit(id), host.unitStats(id)]);
      setUnit(detail);
      setStats(numbers);
    });
  }, [id, run]);

  if (!unit || !stats) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Properties</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/properties/${unit.propertyId}`}>{unit.propertyName}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/units/${unit.id}`}>{unit.name}</Link>
      </nav>
      <div className="page-head">
        <h1>Guest stats</h1>
      </div>
      <p className="muted">Counts only. You never see what guests wrote to Fetivi.</p>

      <div className="editor">
        <section className="panel" aria-label="Totals">
          <Figures totals={stats.totals} />
        </section>
        <TopTopics topics={stats.topTopics} />
        <section className="panel" aria-labelledby={staysId}>
          <h2 id={staysId}>Stays</h2>
          {stats.stays.length > 0 ? (
            <ul className="rows table stats-stays-table">
              <li className="table-head" aria-hidden="true">
                <span>Dates</span>
                <span>Booker</span>
                <span>Conversations</span>
                <span>Answers</span>
                <span>Helpful</span>
              </li>
              {stats.stays.map((s) => (
                <li key={s.stayId}>
                  <Link to={`/stays/${s.stayId}`} className="row-link">
                    <strong>{dateRange(s.checkIn, s.checkout)}</strong>
                    <span className="muted">{s.bookerName ?? '—'}</span>
                    <span>
                      {s.conversations}
                      <span className="cell-label"> conversations</span>
                    </span>
                    <span>
                      {s.answers}
                      <span className="cell-label"> answers</span>
                    </span>
                    <span>
                      {thumbsRatio(s.up, s.down)}
                      <span className="cell-label"> helpful</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No Stays have started yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
