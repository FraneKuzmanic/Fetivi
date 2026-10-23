import {
  RECOMMENDATION_WINDOW_DAYS,
  STALENESS_NEAR_DAYS,
} from '@fetivi/domain/curation-vocabulary';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { catalog, curation, type Destination, type StalenessRecord } from '../../api';
import { CATALOG_KIND_LABELS, PLACE_CATEGORY_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';
import { StalenessChip } from '../catalog/StalenessChip';

const kindLabel = (r: StalenessRecord) =>
  r.placeCategory ? PLACE_CATEGORY_LABELS[r.placeCategory] : CATALOG_KIND_LABELS[r.kind];

const recommended = (n: number) =>
  n === 0
    ? `Not recommended in the last ${RECOMMENDATION_WINDOW_DAYS} days`
    : `Recommended ${n} ${n === 1 ? 'time' : 'times'} in ${RECOMMENDATION_WINDOW_DAYS} days`;

/** /admin/curation/staleness: the records most likely to mislead guests, worst first. */
export function StalenessPage() {
  const { busy, error, run } = useAction();
  const [destinationId, setDestinationId] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [records, setRecords] = useState<StalenessRecord[] | null>(null);

  const load = useCallback(async () => {
    setRecords((await curation.staleness(destinationId || undefined)).records);
  }, [destinationId]);

  useEffect(() => {
    setRecords(null);
    void run(load);
  }, [run, load]);

  useEffect(() => {
    void run(async () => setDestinations((await catalog.destinations()).destinations));
  }, [run]);

  const verify = (id: string) =>
    run(async () => {
      await catalog.verify(id);
      setRecords((rows) => rows?.filter((r) => r.id !== id) ?? null);
    });

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/curation">Curation</Link>
      </nav>
      <div className="page-head">
        <h1>Staleness queue</h1>
      </div>
      <p className="muted">
        Past or within {STALENESS_NEAR_DAYS} days of their budget. The most overdue and most
        recommended come first.
      </p>
      <div className="filters">
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
      {error ? <p role="alert">{error}</p> : null}
      {records === null && !error ? <p className="muted">Loading…</p> : null}
      {records?.length === 0 ? <p className="muted">Every record is within its budget.</p> : null}
      {records && records.length > 0 ? (
        <ul className="rows">
          {records.map((r) => (
            <li key={r.id} className="block-row">
              <div className="block-text">
                <span className="block-title">
                  <Link to={`/admin/catalog/records/${r.id}`}>
                    <strong>{r.title}</strong>
                  </Link>
                  <StalenessChip staleness={r.staleness} />
                </span>
                <span className="muted">
                  {kindLabel(r)} · {r.destinationName}
                </span>
                <span className="muted">{recommended(r.recommendations)}</span>
              </div>
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => void verify(r.id)}>
                  Mark verified
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
