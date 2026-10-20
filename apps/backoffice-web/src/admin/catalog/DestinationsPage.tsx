import { Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { catalog, type Destination } from '../../api';
import { useAction } from '../../useAction';

export const areaLine = (d: Pick<Destination, 'radiusKm' | 'centre'>) =>
  `${d.radiusKm} km around ${d.centre.lat.toFixed(4)}, ${d.centre.lng.toFixed(4)}`;

const countLine = (n: number) => (n === 1 ? '1 record' : `${n} records`);

/** /admin/catalog: every destination and the size of its catalog. */
export function DestinationsPage() {
  const { error, run } = useAction();
  const [list, setList] = useState<Destination[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await catalog.destinations()).destinations));
  }, [run]);

  return (
    <>
      <div className="page-head">
        <h1>Catalog</h1>
        <Link className="button primary" to="/admin/catalog/destinations/new">
          <Plus aria-hidden="true" weight="bold" />
          Add destination
        </Link>
      </div>
      <p className="muted">
        Places, events, transport notes and day trips that guests get recommendations from.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">Loading…</p> : null}
      {list?.length === 0 ? (
        <p className="muted">No destinations yet. Add Trogir to start.</p>
      ) : null}
      {list && list.length > 0 ? (
        <ul className="rows table">
          <li className="table-head" aria-hidden="true">
            <span>Destination</span>
            <span>Area</span>
            <span>Records</span>
          </li>
          {list.map((d) => (
            <li key={d.id}>
              <Link to={`/admin/catalog/destinations/${d.id}`} className="row-link">
                <strong>{d.name}</strong>
                <span className="muted">{areaLine(d)}</span>
                <span className="muted">{countLine(d.recordCount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
