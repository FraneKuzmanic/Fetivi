import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { host } from '../../api';
import { SelectField } from '../../forms/fields';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { liveUnits } from './format';
import { type StayDraft, StayFields, stayBody } from './StayFields';

export function NewStayPage() {
  const { t } = useTranslation(['host', 'common']);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { busy, error, run } = useAction();
  const [units, setUnits] = useState<{ id: string; label: string }[] | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StayDraft>({
    checkIn: null,
    checkout: null,
    partySize: 2,
    bookerName: null,
    reservationNumber: null,
  });

  useEffect(() => {
    void run(async () => {
      const live = liveUnits((await host.properties()).properties);
      setUnits(live);
      const wanted = params.get('unit');
      setUnitId(live.find((u) => u.id === wanted)?.id ?? live[0]?.id ?? null);
    });
  }, [run, params]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!unitId) return;
    void run(async () => {
      const created = await host.createStay(unitId, stayBody(draft));
      navigate(`/stays/${created.id}?new=1`, { replace: true });
    });
  }

  usePageTitle(t('stays.newTitle'));

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/stays">{t('stays.title')}</Link>
      </nav>
      {units === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {units?.length === 0 ? (
        <section className="panel narrow">
          <p>{t('stays.notApprovedYet')}</p>
          <p>
            <Link to="/properties">{t('stays.goToProperties')}</Link>
          </p>
        </section>
      ) : null}
      {units === null && error ? <p role="alert">{error}</p> : null}
      {units && units.length > 0 ? (
        <section className="panel narrow">
          <form onSubmit={submit}>
            <div className="fields">
              <SelectField
                label={t('stays.unit')}
                value={unitId}
                options={units.map((u) => u.id)}
                labels={Object.fromEntries(units.map((u) => [u.id, u.label]))}
                onChange={setUnitId}
              />
              <StayFields value={draft} onChange={setDraft} />
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <p className="muted">{t('stays.createsPin')}</p>
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                {t('stays.register')}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
