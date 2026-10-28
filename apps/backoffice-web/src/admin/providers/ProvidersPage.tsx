import { Handshake, Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type Provider, providers } from '../../api';
import { i18next, localeOf } from '../../i18n';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { percentFromBp } from './money';

/** "15 %", "12.5 %" ("12,5 %" in Croatian): a commission without trailing zeros. */
export const percentText = (bp: number) =>
  `${percentFromBp(bp).toLocaleString(localeOf(i18next.language), { maximumFractionDigits: 2 })} %`;

/** /admin/providers: every Provider with its deal and the number of its Offers. */
export function ProvidersPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { error, run } = useAction();
  const [list, setList] = useState<Provider[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await providers.list()).providers));
  }, [run]);

  const add = (
    <Link className="button primary" to="/admin/providers/new">
      <Plus aria-hidden="true" weight="bold" />
      {t('providers.add')}
    </Link>
  );

  usePageTitle(t('providers.title'));

  return (
    <>
      {list && list.length > 0 ? <div className="page-head">{add}</div> : null}
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {list?.length === 0 ? (
        <EmptyState icon={Handshake} title={t('providers.none')} action={add}>
          {t('providers.noneBody')}
        </EmptyState>
      ) : null}
      {list && list.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('providers.provider')}</th>
                <th scope="col" className="wide-only">
                  {t('providers.email')}
                </th>
                <th scope="col" className="num wide-only">
                  {t('providers.commission')}
                </th>
                <th scope="col" className="num">
                  {t('providers.offers')}
                </th>
                <th scope="col">{t('providers.status')}</th>
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
                      <span className="chip ok">{t('providers.active')}</span>
                    ) : (
                      <span className="chip neutral">{t('providers.paused')}</span>
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
