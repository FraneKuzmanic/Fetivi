import { ThumbsUp } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type AdminFeedbackStats, admin } from '../../api';
import { useLabels } from '../../i18n/useLabels';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { Figures, percent, TopTopics, thumbsRatio } from '../../stats/StatsWidgets';
import { useAction } from '../../useAction';

const FLAGGED = '/admin/curation?kind=guest_flagged';

/** Answer feedback across every unit (43 AC 4), with the PRD's proposed target beside it. */
export function FeedbackStatsPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { error, run } = useAction();
  const [stats, setStats] = useState<AdminFeedbackStats | null>(null);
  const unitsId = useId();

  useEffect(() => {
    void run(async () => setStats(await admin.feedbackStats()));
  }, [run]);

  usePageTitle(t('feedback.title'));

  if (!stats)
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  const { totals } = stats;

  return (
    <div className="editor">
      <section className="panel" aria-label={t('common:misc.totals')}>
        <Figures totals={totals} />
        <p className="reasons-line">
          {labels.feedbackReason.wrong} {totals.wrong} · {labels.feedbackReason.outdated}{' '}
          {totals.outdated} · {labels.feedbackReason.not_helpful} {totals.notHelpful}
          <span className="muted">
            {' '}
            {t('feedback.wrongShare', {
              percent: percent(totals.wrong + totals.outdated, totals.answers),
            })}
          </span>
        </p>
      </section>
      <TopTopics topics={stats.topTopics} />
      <section className="panel" aria-labelledby={unitsId}>
        <h2 id={unitsId}>{t('feedback.units')}</h2>
        {stats.units.length > 0 ? (
          <div className="table-frame">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('feedback.unit')}</th>
                  <th scope="col" className="num wide-only">
                    {t('feedback.stays')}
                  </th>
                  <th scope="col" className="num wide-only">
                    {t('feedback.conversations')}
                  </th>
                  <th scope="col" className="num">
                    {t('feedback.answers')}
                  </th>
                  <th scope="col" className="num">
                    {t('feedback.helpful')}
                  </th>
                  <th scope="col" className="num wide-only">
                    {labels.feedbackReason.wrong}
                  </th>
                  <th scope="col" className="num wide-only">
                    {labels.feedbackReason.outdated}
                  </th>
                  <th scope="col" className="num wide-only">
                    {labels.feedbackReason.not_helpful}
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
          <EmptyState icon={ThumbsUp} title={t('feedback.none')}>
            {t('feedback.noneBody')}
          </EmptyState>
        )}
      </section>
    </div>
  );
}
