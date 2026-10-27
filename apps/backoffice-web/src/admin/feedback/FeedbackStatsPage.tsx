import { ThumbsUp } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { type AdminFeedbackStats, admin } from '../../api';
import { FEEDBACK_REASON_LABELS } from '../../forms/labels';
import { EmptyState } from '../../shell/EmptyState';
import { Figures, percent, TopTopics, thumbsRatio } from '../../stats/StatsWidgets';
import { useAction } from '../../useAction';

const FLAGGED = '/admin/curation?kind=guest_flagged';

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
        <h1>Feedback</h1>
        <Link className="button" to={FLAGGED}>
          Review flagged places
        </Link>
      </div>
      <p className="muted">
        How guests rate Fetivi’s answers. Proposed target: over 80% helpful, and under 5% wrong or
        outdated.
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
        </section>
        <TopTopics topics={stats.topTopics} />
        <section className="panel" aria-labelledby={unitsId}>
          <h2 id={unitsId}>Units</h2>
          {stats.units.length > 0 ? (
            <div className="table-frame">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col" className="num wide-only">
                      Stays
                    </th>
                    <th scope="col" className="num wide-only">
                      Conversations
                    </th>
                    <th scope="col" className="num">
                      Answers
                    </th>
                    <th scope="col" className="num">
                      Helpful
                    </th>
                    <th scope="col" className="num wide-only">
                      {FEEDBACK_REASON_LABELS.wrong}
                    </th>
                    <th scope="col" className="num wide-only">
                      {FEEDBACK_REASON_LABELS.outdated}
                    </th>
                    <th scope="col" className="num wide-only">
                      {FEEDBACK_REASON_LABELS.not_helpful}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.units.map((u) => (
                    <tr key={u.unitId}>
                      <td>
                        <div className="cell-main">
                          <strong>{u.unitName}</strong>
                          <span className="cell-sub">
                            {u.propertyName} · {u.hostEmail}
                          </span>
                        </div>
                      </td>
                      <td className="num wide-only">{u.stays}</td>
                      <td className="num wide-only">{u.conversations}</td>
                      <td className="num">{u.answers}</td>
                      <td className="num">{thumbsRatio(u.up, u.down)}</td>
                      <td className="num wide-only">
                        {u.wrong > 0 ? <Link to={FLAGGED}>{u.wrong}</Link> : 0}
                      </td>
                      <td className="num wide-only">
                        {u.outdated > 0 ? <Link to={FLAGGED}>{u.outdated}</Link> : 0}
                      </td>
                      <td className="num wide-only">{u.notHelpful}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ThumbsUp} title="No rated answers yet">
              When guests rate Fetivi’s answers, each unit’s results show up here.
            </EmptyState>
          )}
        </section>
      </div>
    </>
  );
}
