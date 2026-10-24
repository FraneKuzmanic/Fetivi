import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { type AdminFeedbackStats, admin } from '../../api';
import { FEEDBACK_REASON_LABELS } from '../../forms/labels';
import { Figures, TopTopics, thumbsRatio } from '../../host/stats/UnitStatsPage';
import { useAction } from '../../useAction';

const FLAGGED = '/admin/curation?kind=guest_flagged';

const percent = (part: number, whole: number) =>
  whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;

/** Answer feedback across every unit (43 AC 4), with the PRD's proposed target beside it. */
export function FeedbackStatsPage() {
  const { error, run } = useAction();
  const [stats, setStats] = useState<AdminFeedbackStats | null>(null);
  const unitsId = useId();

  useEffect(() => {
    void run(async () => setStats(await admin.feedbackStats()));
  }, [run]);

  if (!stats) return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  const { totals } = stats;

  return (
    <>
      <div className="page-head">
        <h1>Answer feedback</h1>
      </div>
      <p className="muted">
        Target: above 80% helpful, wrong or outdated under 5% of answers (proposed).
      </p>

      <div className="editor">
        <section className="panel" aria-label="Totals">
          <Figures totals={totals} />
          <p className="reasons-line">
            {FEEDBACK_REASON_LABELS.wrong} {totals.wrong} · {FEEDBACK_REASON_LABELS.outdated}{' '}
            {totals.outdated} · {FEEDBACK_REASON_LABELS.not_helpful} {totals.notHelpful}
            <span className="muted">
              {' '}
              · wrong or outdated: {percent(totals.wrong + totals.outdated, totals.answers)} of
              answers
            </span>
          </p>
          <p>
            <Link to={FLAGGED}>Review guest-flagged places</Link>
          </p>
        </section>
        <TopTopics topics={stats.topTopics} />
        <section className="panel" aria-labelledby={unitsId}>
          <h2 id={unitsId}>Units</h2>
          {stats.units.length > 0 ? (
            <div className="table-scroll">
              <table className="events-table feedback-table">
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col">Stays</th>
                    <th scope="col">Conversations</th>
                    <th scope="col">Answers</th>
                    <th scope="col">Helpful</th>
                    <th scope="col">{FEEDBACK_REASON_LABELS.wrong}</th>
                    <th scope="col">{FEEDBACK_REASON_LABELS.outdated}</th>
                    <th scope="col">{FEEDBACK_REASON_LABELS.not_helpful}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.units.map((u) => (
                    <tr key={u.unitId}>
                      <td>
                        {u.unitName}
                        <span className="cell-sub">{u.propertyName}</span>
                        <span className="cell-sub">{u.hostEmail}</span>
                      </td>
                      <td>{u.stays}</td>
                      <td>{u.conversations}</td>
                      <td>{u.answers}</td>
                      <td>{thumbsRatio(u.up, u.down)}</td>
                      <td>{u.wrong > 0 ? <Link to={FLAGGED}>{u.wrong}</Link> : 0}</td>
                      <td>{u.outdated > 0 ? <Link to={FLAGGED}>{u.outdated}</Link> : 0}</td>
                      <td>{u.notHelpful}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No answers yet.</p>
          )}
        </section>
      </div>
    </>
  );
}
