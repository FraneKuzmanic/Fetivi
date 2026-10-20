import { Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type Provider, providers } from '../../api';
import { useAction } from '../../useAction';
import { percentFromBp } from './money';

const offerCountLine = (n: number) => (n === 1 ? '1 Offer' : `${n} Offers`);

/** /admin/providers: every Provider with its deal and the number of its Offers. */
export function ProvidersPage() {
  const { error, run } = useAction();
  const [list, setList] = useState<Provider[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await providers.list()).providers));
  }, [run]);

  return (
    <>
      <div className="page-head">
        <h1>Providers</h1>
        <Link className="button primary" to="/admin/providers/new">
          <Plus aria-hidden="true" weight="bold" />
          Add provider
        </Link>
      </div>
      <p className="muted">
        Local businesses you have a deal with. They get each Order by email; they have no login.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">Loading…</p> : null}
      {list?.length === 0 ? <p className="muted">No Providers yet.</p> : null}
      {list && list.length > 0 ? (
        <ul className="rows table providers-table">
          <li className="table-head" aria-hidden="true">
            <span>Provider</span>
            <span>Contact</span>
            <span>Commission</span>
            <span>Offers</span>
          </li>
          {list.map((p) => (
            <li key={p.id}>
              <Link to={`/admin/providers/${p.id}`} className="row-link">
                <span className="with-icon">
                  <strong>{p.name}</strong>
                  {p.active ? null : <span className="chip neutral">Paused</span>}
                </span>
                <span className="muted">{p.email}</span>
                <span className="muted">
                  {percentFromBp(p.commissionBp).toFixed(2)} %
                  <span className="commission-word"> commission</span>
                </span>
                <span className="muted">{offerCountLine(p.offerCount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
