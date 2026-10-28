import { Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { host, type PropertySummary } from '../api';
import { usePageTitle } from '../shell/PageTitle';
import { useAction } from '../useAction';

export function StatusChip({ approved }: { approved: boolean }) {
  return approved ? (
    <span className="chip ok">Approved</span>
  ) : (
    <span className="chip wait">Waiting for approval</span>
  );
}

export function PropertiesPage() {
  const { error, run } = useAction();
  const [list, setList] = useState<PropertySummary[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await host.properties()).properties));
  }, [run]);

  usePageTitle('Properties');

  return (
    <>
      <div className="page-head">
        <Link className="button primary" to="/properties/new">
          <Plus aria-hidden="true" weight="bold" />
          Add property
        </Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">Loading…</p> : null}
      {list?.length === 0 ? (
        <p className="muted">No properties yet. Add your first one to start.</p>
      ) : null}
      {list && list.length > 0 ? (
        <ul className="rows table">
          <li className="table-head" aria-hidden="true">
            <span>Property</span>
            <span>Units</span>
            <span>Status</span>
          </li>
          {list.map((p) => (
            <li key={p.id}>
              <Link to={`/properties/${p.id}`} className="row-link">
                <span>
                  <strong>{p.name}</strong>
                  {p.city ? <span className="muted"> · {p.city}</span> : null}
                </span>
                <span className="muted">
                  {p.units.length === 0
                    ? 'No units'
                    : p.units.length === 1
                      ? '1 unit'
                      : `${p.units.length} units`}
                </span>
                <span>
                  <StatusChip approved={p.approved} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
