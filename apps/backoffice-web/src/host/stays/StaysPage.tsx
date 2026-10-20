import { PIN_WARNING_DAYS } from '@fetivi/domain/stay-vocabulary';
import { Plus } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { host, type PropertySummary, type Stay } from '../../api';
import { useAction } from '../../useAction';
import { dateRange, guestsLabel, liveUnits, nightsLabel, PHASE_LABELS } from './format';

export function StayChips({ stay }: { stay: Stay }) {
  return (
    <span className="chips">
      <span className={`chip ${stay.phase === 'in_stay' ? 'ok' : 'neutral'}`}>
        {PHASE_LABELS[stay.phase]}
      </span>
      {stay.possiblyCancelled ? <span className="chip fail">Possibly cancelled</span> : null}
      {stay.pinSentAt ? (
        <span className="chip ok">PIN sent</span>
      ) : stay.pinWarning ? (
        <span className="chip wait">PIN not sent</span>
      ) : null}
    </span>
  );
}

export function StaysPage() {
  const [params, setParams] = useSearchParams();
  const { error, run } = useAction();
  const [properties, setProperties] = useState<PropertySummary[]>([]);
  const [list, setList] = useState<Stay[] | null>(null);
  const unitId = params.get('unit') ?? '';
  const past = params.get('past') === '1';

  useEffect(() => {
    void run(async () => setProperties((await host.properties()).properties));
  }, [run]);

  useEffect(() => {
    setList(null);
    void run(async () =>
      setList((await host.stays({ ...(unitId ? { unitId } : {}), past })).stays),
    );
  }, [run, unitId, past]);

  const setFilter = (next: { unit?: string; past?: boolean }) => {
    const unit = next.unit ?? unitId;
    const isPast = next.past ?? past;
    setParams({ ...(unit ? { unit } : {}), ...(isPast ? { past: '1' } : {}) }, { replace: true });
  };

  const several = properties.length > 1;
  // Only live units can have Stays.
  const units = liveUnits(properties);
  const warned = list?.filter((s) => s.pinWarning).length ?? 0;

  return (
    <>
      <div className="page-head">
        <h1>Stays</h1>
        <Link className="button primary" to={unitId ? `/stays/new?unit=${unitId}` : '/stays/new'}>
          <Plus aria-hidden="true" weight="bold" />
          Register a Stay
        </Link>
      </div>
      <div className="filters">
        <div className="segmented wrap" role="tablist" aria-label="When">
          {[false, true].map((isPast) => (
            <button
              key={String(isPast)}
              type="button"
              role="tab"
              aria-selected={past === isPast}
              onClick={() => setFilter({ past: isPast })}
            >
              {isPast ? 'Past' : 'Current and upcoming'}
            </button>
          ))}
        </div>
        {units.length > 1 ? (
          <label className="field inline-field">
            <span className="field-label">Unit</span>
            <select value={unitId} onChange={(e) => setFilter({ unit: e.target.value })}>
              <option value="">All units</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {warned > 0 ? (
        <p className="warning">
          {warned === 1
            ? `1 Stay starts within ${PIN_WARNING_DAYS} days and its PIN is not marked as sent.`
            : `${warned} Stays start within ${PIN_WARNING_DAYS} days and their PIN is not marked as sent.`}
        </p>
      ) : null}
      {list === null && !error ? <p className="muted">Loading…</p> : null}
      {list?.length === 0 ? (
        <p className="muted">
          {past ? 'No past Stays.' : 'No Stays yet. Register one to get a PIN for your guests.'}
        </p>
      ) : null}
      {list && list.length > 0 ? (
        <ul className="rows table stays-table">
          <li className="table-head" aria-hidden="true">
            <span>Dates</span>
            <span>Unit</span>
            <span>PIN</span>
            <span>Status</span>
          </li>
          {list.map((s) => (
            <li key={s.id}>
              <Link to={`/stays/${s.id}`} className="row-link">
                <span>
                  <strong>{dateRange(s.checkIn, s.checkout)}</strong>
                  <span className="muted">
                    {' '}
                    · {nightsLabel(s.checkIn, s.checkout)} · {guestsLabel(s.partySize)}
                  </span>
                </span>
                <span className="muted">
                  {several ? `${s.propertyName} · ${s.unitName}` : s.unitName}
                </span>
                <span className="mono-text">{s.pin}</span>
                <StayChips stay={s} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
