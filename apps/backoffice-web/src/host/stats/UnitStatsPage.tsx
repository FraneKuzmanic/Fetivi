import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { host, type UnitDetail, type UnitStats } from '../../api';
import { usePageTitle } from '../../shell/PageTitle';
import { Figures, TopTopics, thumbsRatio } from '../../stats/StatsWidgets';
import { useAction } from '../../useAction';
import { dateRange } from '../stays/format';

/** A unit's guest stats (43 AC 3): counts and topics only, never what guests wrote. */
export function UnitStatsPage() {
  const { t } = useTranslation(['host', 'common']);
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

  usePageTitle(t('unitStats.title'));

  if (!unit || !stats) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  }

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/properties">{t('properties.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/properties/${unit.propertyId}`}>{unit.propertyName}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/units/${unit.id}`}>{unit.name}</Link>
      </nav>
      <p className="muted">{t('unitStats.countsOnly')}</p>

      <div className="editor">
        <section className="panel" aria-label={t('common:misc.totals')}>
          <Figures totals={stats.totals} />
        </section>
        <TopTopics topics={stats.topTopics} />
        <section className="panel" aria-labelledby={staysId}>
          <h2 id={staysId}>{t('unitStats.stays')}</h2>
          {stats.stays.length > 0 ? (
            <ul className="rows table stats-stays-table">
              <li className="table-head" aria-hidden="true">
                <span>{t('unitStats.dates')}</span>
                <span>{t('unitStats.booker')}</span>
                <span>{t('unitStats.conversations')}</span>
                <span>{t('unitStats.answers')}</span>
                <span>{t('unitStats.helpful')}</span>
              </li>
              {stats.stays.map((s) => (
                <li key={s.stayId}>
                  <Link to={`/stays/${s.stayId}`} className="row-link">
                    <strong>{dateRange(s.checkIn, s.checkout)}</strong>
                    <span className="muted">{s.bookerName ?? '—'}</span>
                    <span>
                      {s.conversations}
                      <span className="cell-label"> {t('unitStats.conversationsCell')}</span>
                    </span>
                    <span>
                      {s.answers}
                      <span className="cell-label"> {t('unitStats.answersCell')}</span>
                    </span>
                    <span>
                      {thumbsRatio(s.up, s.down)}
                      <span className="cell-label"> {t('unitStats.helpfulCell')}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t('unitStats.none')}</p>
          )}
        </section>
      </div>
    </>
  );
}
