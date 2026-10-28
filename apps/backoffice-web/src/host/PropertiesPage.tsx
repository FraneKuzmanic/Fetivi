import { Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { host, type PropertySummary } from '../api';
import { usePageTitle } from '../shell/PageTitle';
import { useAction } from '../useAction';

export function StatusChip({ approved }: { approved: boolean }) {
  const { t } = useTranslation(['host', 'common']);
  return approved ? (
    <span className="chip ok">{t('properties.approved')}</span>
  ) : (
    <span className="chip wait">{t('properties.waiting')}</span>
  );
}

export function PropertiesPage() {
  const { t } = useTranslation(['host', 'common']);
  const { error, run } = useAction();
  const [list, setList] = useState<PropertySummary[] | null>(null);

  useEffect(() => {
    void run(async () => setList((await host.properties()).properties));
  }, [run]);

  usePageTitle(t('properties.title'));

  return (
    <>
      <div className="page-head">
        <Link className="button primary" to="/properties/new">
          <Plus aria-hidden="true" weight="bold" />
          {t('properties.add')}
        </Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {list?.length === 0 ? <p className="muted">{t('properties.none')}</p> : null}
      {list && list.length > 0 ? (
        <ul className="rows table">
          <li className="table-head" aria-hidden="true">
            <span>{t('properties.property')}</span>
            <span>{t('properties.units')}</span>
            <span>{t('properties.status')}</span>
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
                    ? t('properties.noUnits')
                    : t('properties.unitCount', { count: p.units.length })}
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
