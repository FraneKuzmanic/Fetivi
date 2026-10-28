import { MapTrifold, Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { catalog, type Destination } from '../../api';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';

/** /admin/catalog: every destination and the size of its catalog. */
export function DestinationsPage() {
  const { error, run } = useAction();
  const [list, setList] = useState<Destination[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await catalog.destinations()).destinations));
  }, [run]);

  const add = (
    <Link className="button primary" to="/admin/catalog/destinations/new">
      <Plus aria-hidden="true" weight="bold" />
      Add destination
    </Link>
  );

  usePageTitle('Catalog');

  return (
    <>
      {list && list.length > 0 ? <div className="page-head">{add}</div> : null}
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">Loading…</p> : null}
      {list?.length === 0 ? (
        <EmptyState icon={MapTrifold} title="No destinations yet" action={add}>
          A destination is a town and the area around it. Add one, then find the places worth
          recommending there.
        </EmptyState>
      ) : null}
      {list && list.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Destination</th>
                <th scope="col" className="wide-only">
                  Area
                </th>
                <th scope="col" className="num">
                  Records
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className="linked">
                  <td>
                    <Link className="row-target" to={`/admin/catalog/destinations/${d.id}`}>
                      {d.name}
                    </Link>
                  </td>
                  <td className="wide-only">Within {d.radiusKm} km</td>
                  <td className="num">{d.recordCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
