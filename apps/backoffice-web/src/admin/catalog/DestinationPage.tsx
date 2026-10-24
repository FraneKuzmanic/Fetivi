import { CATALOG_KINDS, type CatalogKind } from '@fetivi/domain/catalog-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import { CaretRight, Plus } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  type CatalogRecordSummary,
  catalog,
  type Destination,
  type DestinationInput,
} from '../../api';
import { NumberField, Section, SelectField, TextField } from '../../forms/fields';
import { CATALOG_KIND_LABELS, PLACE_CATEGORY_LABELS } from '../../forms/labels';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useAction } from '../../useAction';
import { StalenessChip } from './StalenessChip';

const ZONES = Intl.supportedValuesOf('timeZone');

interface AreaDraft {
  name: string | null;
  lat: number | null;
  lng: number | null;
  radiusKm: number | null;
  timezone: string;
}

const draftOf = (d: Destination): AreaDraft => ({
  name: d.name,
  lat: d.centre.lat,
  lng: d.centre.lng,
  radiusKm: d.radiusKm,
  timezone: d.timezone,
});

/** The draft as an API body; missing numbers go as they are and the API refuses them. */
const inputOf = (d: AreaDraft) =>
  ({
    name: d.name ?? '',
    centre: { lat: d.lat, lng: d.lng },
    radiusKm: d.radiusKm,
    timezone: d.timezone,
  }) as DestinationInput;

function AreaFields({
  draft,
  onChange,
}: {
  draft: AreaDraft;
  onChange: (draft: AreaDraft) => void;
}) {
  const set =
    <K extends keyof AreaDraft>(key: K) =>
    (value: AreaDraft[K]) =>
      onChange({ ...draft, [key]: value });
  const zones = ZONES.includes(draft.timezone) ? ZONES : [draft.timezone, ...ZONES];
  return (
    <>
      <TextField
        label="Name"
        hint="For example Trogir."
        value={draft.name}
        maxLength={LIMITS.name}
        required
        onChange={set('name')}
      />
      <div className="field-row">
        <NumberField
          label="Centre latitude"
          value={draft.lat}
          min={-90}
          max={90}
          step="any"
          placeholder="43.5169"
          onChange={set('lat')}
        />
        <NumberField
          label="Centre longitude"
          value={draft.lng}
          min={-180}
          max={180}
          step="any"
          placeholder="16.2513"
          onChange={set('lng')}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Radius (km)"
          hint="Properties inside it use this catalog."
          value={draft.radiusKm}
          min={1}
          max={100}
          step="any"
          onChange={set('radiusKm')}
        />
        <label className="field">
          <span className="field-label">Time zone</span>
          <select value={draft.timezone} onChange={(e) => set('timezone')(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

/** /admin/catalog/destinations/new */
export function NewDestinationPage() {
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState<AreaDraft>({
    name: null,
    lat: null,
    lng: null,
    radiusKm: 15,
    timezone: 'Europe/Zagreb',
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await catalog.createDestination(inputOf(draft));
      navigate(`/admin/catalog/destinations/${created.id}`, { replace: true });
    });
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
      </nav>
      <div className="page-head">
        <h1>Add destination</h1>
      </div>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <AreaFields draft={draft} onChange={setDraft} />
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Create destination
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

type Tab = 'all' | CatalogKind;
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'place', label: 'Places' },
  { id: 'event', label: 'Events' },
  { id: 'transport_note', label: 'Transport' },
  { id: 'day_trip', label: 'Day trips' },
];

/** /admin/catalog/destinations/:id: the area and its records. */
export function DestinationPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [destination, setDestination] = useState<Destination | null>(null);
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const [records, setRecords] = useState<CatalogRecordSummary[] | null>(null);

  const reloadRecords = useCallback(
    async () => setRecords((await catalog.records(id)).records),
    [id],
  );

  useEffect(() => {
    void run(async () => {
      const fresh = await catalog.destination(id);
      setDestination(fresh);
      setDraft(draftOf(fresh));
      await reloadRecords();
    });
  }, [id, run, reloadRecords]);

  usePendingRefresh(records ?? [], reloadRecords);

  if (!destination || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const saveArea = async () => {
    const saved = await catalog.updateDestination(id, inputOf(draft));
    setDestination(saved);
    setDraft(draftOf(saved));
  };

  const hasRecords = (records?.length ?? destination.recordCount) > 0;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
      </nav>
      <div className="page-head">
        <h1>{destination.name}</h1>
        <Link className="button" to={`/admin/catalog/destinations/${id}/seeding`}>
          Seeding
        </Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        <RecordsPanel destinationId={id} records={records} />

        <Section
          title="Area"
          description="A centre and a radius. Event times are entered in the time zone."
          onSave={saveArea}
        >
          <AreaFields draft={draft} onChange={setDraft} />
        </Section>

        <section className="panel danger-zone">
          <h2>Delete destination</h2>
          <p className="muted">
            {hasRecords
              ? 'Delete its records first. A destination with records cannot be deleted.'
              : 'Deletes this destination. This cannot be undone.'}
          </p>
          <button
            type="button"
            className="danger"
            disabled={busy || hasRecords}
            onClick={() => {
              if (window.confirm(`Delete ${destination.name}?`)) {
                void run(async () => {
                  await catalog.deleteDestination(id);
                  navigate('/admin/catalog', { replace: true });
                });
              }
            }}
          >
            Delete destination
          </button>
        </section>
      </div>
    </>
  );
}

function recordLine(r: CatalogRecordSummary): string {
  const kind = r.placeCategory
    ? PLACE_CATEGORY_LABELS[r.placeCategory]
    : CATALOG_KIND_LABELS[r.kind];
  if (r.kind !== 'event' || !r.startsAt || !r.endsAt) return kind;
  return `${kind} · ${r.startsAt.replace('T', ' ')} to ${r.endsAt.replace('T', ' ')}`;
}

function RecordsPanel({
  destinationId,
  records,
}: {
  destinationId: string;
  records: CatalogRecordSummary[] | null;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const [newKind, setNewKind] = useState<CatalogKind>('place');
  const shown = records?.filter((r) => tab === 'all' || r.kind === tab) ?? null;
  const addKind = tab === 'all' ? newKind : tab;

  return (
    <section className="panel" aria-labelledby="records-heading">
      <div className="page-head">
        <h2 id="records-heading">Records</h2>
        <div className="segmented wrap" role="tablist" aria-label="Kind">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {shown === null ? <p className="muted">Loading…</p> : null}
      {shown?.length === 0 ? <p className="muted">Nothing here yet.</p> : null}
      {shown && shown.length > 0 ? (
        <ul className="rows">
          {shown.map((r) => (
            <li key={r.id}>
              <Link to={`/admin/catalog/records/${r.id}`} className="row-link record-row">
                <span className="block-text record-text">
                  <strong>{r.title}</strong>
                  <span className="muted">{recordLine(r)}</span>
                </span>
                <span className="record-chips">
                  <StalenessChip staleness={r.staleness} />
                  <TranslationChip status={r.translation.status} />
                </span>
                <CaretRight className="record-caret" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="inline-form record-add">
        {tab === 'all' ? (
          <SelectField
            label="New record"
            value={newKind}
            options={CATALOG_KINDS}
            labels={CATALOG_KIND_LABELS}
            onChange={(k) => k && setNewKind(k)}
          />
        ) : null}
        <button
          type="button"
          className="primary"
          onClick={() => navigate(`/admin/catalog/destinations/${destinationId}/new/${addKind}`)}
        >
          <Plus aria-hidden="true" weight="bold" />
          Add {CATALOG_KIND_LABELS[addKind].toLowerCase()}
        </button>
      </div>
    </section>
  );
}
