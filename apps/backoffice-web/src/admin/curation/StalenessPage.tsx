import {
  RECOMMENDATION_WINDOW_DAYS,
  STALENESS_NEAR_DAYS,
} from '@fetivi/domain/curation-vocabulary';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { catalog, curation, type Destination, type StalenessRecord } from '../../api';
import { formatDay } from '../../forms/datetime';
import { CATALOG_KIND_LABELS, PLACE_CATEGORY_LABELS } from '../../forms/labels';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';

const kindLabel = (r: StalenessRecord) =>
  r.placeCategory ? PLACE_CATEGORY_LABELS[r.placeCategory] : CATALOG_KIND_LABELS[r.kind];

const recommended = (n: number) =>
  n === 0
    ? 'Not lately'
    : `${n} ${n === 1 ? 'time' : 'times'} in ${RECOMMENDATION_WINDOW_DAYS} days`;

/** "Overdue since 12.10.2026", "Due 05.11.2026", "Never checked". */
export function dueText(r: Pick<StalenessRecord, 'staleness'>): string {
  const { status, staleAt } = r.staleness;
  if (status === 'never_verified') return 'Never checked';
  if (status === 'expired') return 'Ended';
  if (staleAt === null) return 'No re-check needed';
  return status === 'stale' ? `Overdue since ${formatDay(staleAt)}` : `Due ${formatDay(staleAt)}`;
}

/** /admin/curation/staleness: the records most likely to mislead guests, worst first. */
export function StalenessPage() {
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
      setNotice(`${record.title} marked verified.`);
    });

  usePageTitle('Due for a re-check');

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/curation">Curation</Link>
      </nav>
      <p className="muted">
        Places due for a re-check now or in the next {STALENESS_NEAR_DAYS} days. Most overdue and
        most recommended first.
      </p>
      <div className="toolbar">
        <label className="field inline-field">
          <span className="field-label">Destination</span>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
            <option value="">All destinations</option>
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
      {records === null && !error ? <p className="muted">Loading…</p> : null}
      {records?.length === 0 ? (
        <EmptyState icon={ClockCounterClockwise} title="All caught up">
          No place needs a re-check in the next {STALENESS_NEAR_DAYS} days.
        </EmptyState>
      ) : null}
      {records && records.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Place</th>
                <th scope="col">Re-check</th>
                <th scope="col" className="wide-only">
                  Recommended
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
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
                      Mark verified
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
