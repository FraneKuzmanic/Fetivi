import { useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { host, type UnitDetail, type UnitStats } from '../../api';
import { Figures, TopTopics, thumbsRatio } from '../../stats/StatsWidgets';
import { useAction } from '../../useAction';
import { dateRange } from '../stays/format';

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
