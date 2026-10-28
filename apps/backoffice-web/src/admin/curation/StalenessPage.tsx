import {
  RECOMMENDATION_WINDOW_DAYS,
  STALENESS_NEAR_DAYS,
} from '@fetivi/domain/curation-vocabulary';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { catalog, curation, type Destination, type StalenessRecord } from '../../api';
import { formatDay } from '../../forms/datetime';
import { i18next } from '../../i18n';
import { currentLabels } from '../../i18n/useLabels';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';

const kindLabel = (r: StalenessRecord, labels = currentLabels()) =>
  r.placeCategory ? labels.placeCategory[r.placeCategory] : labels.catalogKind[r.kind];

const t = i18next.getFixedT(null, 'admin', 'curation');

const recommended = (n: number) =>
  n === 0 ? t('notLately') : t('times', { count: n, days: RECOMMENDATION_WINDOW_DAYS });

/** "Overdue since 12.10.2026", "Due 05.11.2026", "Never checked". */
export function dueText(r: Pick<StalenessRecord, 'staleness'>): string {
  const { status, staleAt } = r.staleness;
  if (status === 'never_verified') return t('neverChecked');
  if (status === 'expired') return t('ended');
  if (staleAt === null) return t('noRecheck');
  return status === 'stale'
    ? t('overdue', { date: formatDay(staleAt) })
    : t('dueOn', { date: formatDay(staleAt) });
}

/** /admin/curation/staleness: the records most likely to mislead guests, worst first. */
export function StalenessPage() {
  useTranslation('admin');
  const { busy, error, run } = useAction();
  const [destinationId, setDestinationId] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [records, setRecords] = useState<StalenessRecord[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRecords((await curation.staleness(destinationId || undefined)).records);
  }, [destinationId]);

  useEffect(() => {
    setRecords(null);
    setNotice(null);
    void run(load);
  }, [run, load]);

  useEffect(() => {
    void run(async () => setDestinations((await catalog.destinations()).destinations));
  }, [run]);

  const verify = (record: StalenessRecord) =>
    run(async () => {
      setNotice(null);
      await catalog.verify(record.id);
      setRecords((rows) => rows?.filter((r) => r.id !== record.id) ?? null);
      setNotice(t('verified', { title: record.title }));
    });

  usePageTitle(t('due'));

  return (
    <>
      <nav className="crumbs" aria-label={i18next.t('common:page.breadcrumb')}>
        <Link to="/admin/curation">{t('title')}</Link>
      </nav>
      <p className="muted">{t('dueIntro', { days: STALENESS_NEAR_DAYS })}</p>
      <div className="toolbar">
        <label className="field inline-field">
          <span className="field-label">{t('destination')}</span>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
            <option value="">{t('allDestinations')}</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {notice && !error ? (
        <output className="saved" aria-live="polite">
          {notice}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {records === null && !error ? <p className="muted">{i18next.t('common:loading')}</p> : null}
      {records?.length === 0 ? (
        <EmptyState icon={ClockCounterClockwise} title={t('caughtUp')}>
          {t('dueNone', { days: STALENESS_NEAR_DAYS })}
        </EmptyState>
      ) : null}
      {records && records.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('place')}</th>
                <th scope="col">{t('recheck')}</th>
                <th scope="col" className="wide-only">
                  {t('recommended')}
                </th>
                <th scope="col">
                  <span className="visually-hidden">{i18next.t('common:table.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="linked">
                  <td>
                    <div className="cell-main">
                      <Link className="row-target" to={`/admin/catalog/records/${r.id}`}>
                        {r.title}
                      </Link>
                      <span className="cell-sub">
                        {kindLabel(r)} · {r.destinationName}
                      </span>
                    </div>
                  </td>
                  <td className="nowrap">{dueText(r)}</td>
                  <td className="wide-only">{recommended(r.recommendations)}</td>
                  <td className="cell-actions">
                    <button type="button" disabled={busy} onClick={() => void verify(r)}>
                      {t('markVerified')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
