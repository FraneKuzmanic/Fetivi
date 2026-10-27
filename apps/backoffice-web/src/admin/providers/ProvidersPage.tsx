import { Handshake, Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type Provider, providers } from '../../api';
import { EmptyState } from '../../shell/EmptyState';
import { useAction } from '../../useAction';
import { percentFromBp } from './money';

/** "15 %", "12.5 %": a commission without trailing zeros. */
export const percentText = (bp: number) => `${Number(percentFromBp(bp).toFixed(2))} %`;

/** /admin/providers: every Provider with its deal and the number of its Offers. */
export function ProvidersPage() {
  const { error, run } = useAction();
  const [list, setList] = useState<Provider[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await providers.list()).providers));
  }, [run]);

  const add = (
    <Link className="button primary" to="/admin/providers/new">
      <Plus aria-hidden="true" weight="bold" />
      Add provider
    </Link>
  );

  return (
    <>
      <div className="page-head">
        <h1>Providers</h1>
        {list && list.length > 0 ? add : null}
      </div>
      <p className="muted">
        Local businesses you have a deal with. They get each Order by email; they have no login.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">Loading…</p> : null}
      {list?.length === 0 ? (
        <EmptyState icon={Handshake} title="No providers yet" action={add}>
          Add a local business you have a deal with, then the offers guests can book with it.
        </EmptyState>
      ) : null}
      {list && list.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col" className="wide-only">
                  Email
                </th>
                <th scope="col" className="num wide-only">
                  Commission
                </th>
                <th scope="col" className="num">
                  Offers
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="linked">
                  <td>
                    <Link className="row-target" to={`/admin/providers/${p.id}`}>
                      {p.name}
                    </Link>
                  </td>
                  <td className="wide-only">{p.email}</td>
                  <td className="num wide-only">{percentText(p.commissionBp)}</td>
                  <td className="num">{p.offerCount}</td>
                  <td>
                    {p.active ? (
                      <span className="chip ok">Active</span>
                    ) : (
                      <span className="chip neutral">Paused</span>
                    )}
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
