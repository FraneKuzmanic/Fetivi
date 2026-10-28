import { MapTrifold, Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { catalog, type Destination } from '../../api';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';

/** /admin/catalog: every destination and the size of its catalog. */
export function DestinationsPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { error, run } = useAction();
  const [list, setList] = useState<Destination[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await catalog.destinations()).destinations));
  }, [run]);

  const add = (
    <Link className="button primary" to="/admin/catalog/destinations/new">
      <Plus aria-hidden="true" weight="bold" />
      {t('catalog.addDestination')}
    </Link>
  );

  usePageTitle(t('catalog.title'));

  return (
    <>
      {list && list.length > 0 ? <div className="page-head">{add}</div> : null}
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {list?.length === 0 ? (
        <EmptyState icon={MapTrifold} title={t('catalog.noDestinations')} action={add}>
          {t('catalog.noDestinationsBody')}
        </EmptyState>
      ) : null}
      {list && list.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('catalog.destination')}</th>
                <th scope="col" className="wide-only">
                  {t('catalog.area')}
                </th>
                <th scope="col" className="num">
                  {t('catalog.records')}
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
                  <td className="wide-only">{t('catalog.within', { km: d.radiusKm })}</td>
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
