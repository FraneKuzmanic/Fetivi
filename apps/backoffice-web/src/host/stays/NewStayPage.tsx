import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { host, type PropertySummary } from '../../api';
import { SelectField } from '../../forms/fields';
import { useAction } from '../../useAction';
import { type StayDraft, StayFields, stayBody } from './StayFields';

/** Units that accept Stays: approved property, QR issued. */
export function liveUnits(properties: PropertySummary[]) {
  const several = properties.length > 1;
  return properties
    .filter((p) => p.approved)
    .flatMap((p) =>
      p.units
        .filter((u) => u.hasQr)
        .map((u) => ({ id: u.id, label: several ? `${p.name} · ${u.name}` : u.name })),
    );
}

export function NewStayPage() {
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

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/stays">Stays</Link>
      </nav>
      <div className="page-head">
        <h1>Register a Stay</h1>
      </div>
      {units === null && !error ? <p className="muted">Loading…</p> : null}
      {units?.length === 0 ? (
        <section className="panel narrow">
          <p>Stays can be registered once Fetivi has approved a property.</p>
          <p>
            <Link to="/">Go to Properties</Link>
          </p>
        </section>
      ) : null}
      {units === null && error ? <p role="alert">{error}</p> : null}
      {units && units.length > 0 ? (
        <section className="panel narrow">
          <form onSubmit={submit}>
            <div className="fields">
              <SelectField
                label="Unit"
                value={unitId}
                options={units.map((u) => u.id)}
                labels={Object.fromEntries(units.map((u) => [u.id, u.label]))}
                onChange={setUnitId}
              />
              <StayFields value={draft} onChange={setDraft} />
            </div>
            {error ? <p role="alert">{error}</p> : null}
            <p className="muted">Fetivi creates a six-digit PIN for the guests.</p>
            <div className="actions">
              <button type="submit" className="primary" disabled={busy}>
                Register Stay
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
