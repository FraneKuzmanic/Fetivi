import {
  CATALOG_KINDS,
  CATALOG_LIMITS,
  type CatalogKind,
  KIND_HAS_HOURS,
  KIND_HAS_SEASONS,
  PLACE_CATEGORIES,
  type PlaceCategory,
  TRANSPORT_MODES,
  type TransportMode,
} from '@fetivi/domain/catalog-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  type CatalogRecord,
  type CatalogRecordInput,
  type CatalogRecordPatch,
  catalog,
  type LatLng,
} from '../../api';
import { NumberField, Section, SelectField, TextArea, TextField } from '../../forms/fields';
import {
  CATALOG_KIND_LABELS,
  PLACE_CATEGORY_LABELS,
  TRANSPORT_MODE_LABELS,
} from '../../forms/labels';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useAction } from '../../useAction';
import { CatalogTranslations } from './CatalogTranslations';
import {
  ImagesEditor,
  InputField,
  LinksEditor,
  OpeningHoursEditor,
  SeasonsEditor,
  SourcesEditor,
} from './RowEditors';
import { StalenessChip } from './StalenessChip';

interface Coords {
  lat: number | null;
  lng: number | null;
}

const coordsOf = (p: LatLng | null): Coords => ({ lat: p?.lat ?? null, lng: p?.lng ?? null });

/** Both or neither; one alone is sent as is and the API refuses it. */
const locationOf = (c: Coords): LatLng | null =>
  c.lat === null && c.lng === null ? null : ({ lat: c.lat, lng: c.lng } as LatLng);

function CoordsFields({ value, onChange }: { value: Coords; onChange: (c: Coords) => void }) {
  return (
    <div className="field-row">
      <NumberField
        label="Latitude"
        value={value.lat}
        min={-90}
        max={90}
        step="any"
        placeholder="43.5161"
        onChange={(lat) => onChange({ ...value, lat })}
      />
      <NumberField
        label="Longitude"
        value={value.lng}
        min={-180}
        max={180}
        step="any"
        placeholder="16.2475"
        onChange={(lng) => onChange({ ...value, lng })}
      />
    </div>
  );
}

const EVENT_TIME_HINT = "In the destination's time zone.";

/** /admin/catalog/destinations/:id/new/:kind: the kind's required fields, then the full editor. */
export function NewRecordPage() {
  const { id = '', kind: kindParam = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [placeCategory, setPlaceCategory] = useState<PlaceCategory>('restaurant');
  const [transportMode, setTransportMode] = useState<TransportMode>('bus');
  const [coords, setCoords] = useState<Coords>({ lat: null, lng: null });
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [travelMinutes, setTravelMinutes] = useState<number | null>(null);
  const [destinationName, setDestinationName] = useState<string | null>(null);

  useEffect(() => {
    catalog
      .destination(id)
      .then((d) => setDestinationName(d.name))
      .catch(() => {});
  }, [id]);

  if (!(CATALOG_KINDS as readonly string[]).includes(kindParam)) {
    return <Navigate to={`/admin/catalog/destinations/${id}`} replace />;
  }
  const kind = kindParam as CatalogKind;

  function body(): CatalogRecordInput {
    const text = { title: title ?? '', description: description ?? '' };
    const location = locationOf(coords);
    switch (kind) {
      case 'place':
        return { kind, ...text, placeCategory, location: location as LatLng };
      case 'event':
        return { kind, ...text, startsAt: startsAt ?? '', endsAt: endsAt ?? '', location };
      case 'transport_note':
        return { kind, ...text, transportMode };
      case 'day_trip':
        return { kind, ...text, travelMinutes: travelMinutes ?? 0, location };
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await catalog.createRecord(id, body());
      navigate(`/admin/catalog/records/${created.id}`, { replace: true });
    });
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
        <Link to={`/admin/catalog/destinations/${id}`}>{destinationName ?? 'Destination'}</Link>
      </nav>
      <div className="page-head">
        <h1>Add {CATALOG_KIND_LABELS[kind].toLowerCase()}</h1>
      </div>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label="Title"
              value={title}
              maxLength={LIMITS.title}
              required
              onChange={setTitle}
            />
            <TextArea
              label="Description"
              hint="Markdown. Translated into the seven guest languages on save."
              value={description}
              maxLength={LIMITS.blockBody}
              rows={6}
              required
              monospace
              onChange={setDescription}
            />
            {kind === 'place' ? (
              <>
                <SelectField
                  label="Category"
                  value={placeCategory}
                  options={PLACE_CATEGORIES}
                  labels={PLACE_CATEGORY_LABELS}
                  onChange={(c) => c && setPlaceCategory(c)}
                />
                <CoordsFields value={coords} onChange={setCoords} />
              </>
            ) : null}
            {kind === 'event' ? (
              <div className="field-row">
                <InputField
                  label="Starts"
                  type="datetime-local"
                  value={startsAt}
                  required
                  onChange={setStartsAt}
                />
                <InputField
                  label="Ends"
                  type="datetime-local"
                  value={endsAt}
                  required
                  onChange={setEndsAt}
                />
              </div>
            ) : null}
            {kind === 'event' ? <small>{EVENT_TIME_HINT}</small> : null}
            {kind === 'transport_note' ? (
              <SelectField
                label="Mode"
                value={transportMode}
                options={TRANSPORT_MODES}
                labels={TRANSPORT_MODE_LABELS}
                onChange={(m) => m && setTransportMode(m)}
              />
            ) : null}
            {kind === 'day_trip' ? (
              <>
                <NumberField
                  label="Travel time (minutes)"
                  hint="One way, from the destination."
                  value={travelMinutes}
                  min={1}
                  max={CATALOG_LIMITS.travelMinutesMax}
                  onChange={setTravelMinutes}
                />
                <CoordsFields value={coords} onChange={setCoords} />
              </>
            ) : null}
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Create {CATALOG_KIND_LABELS[kind].toLowerCase()}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

type Draft = Pick<
  CatalogRecord,
  | 'title'
  | 'description'
  | 'placeCategory'
  | 'address'
  | 'phone'
  | 'websiteUrl'
  | 'venueName'
  | 'startsAt'
  | 'endsAt'
  | 'transportMode'
  | 'travelMinutes'
  | 'links'
  | 'fieldSources'
  | 'seasons'
  | 'openingHours'
  | 'images'
>;

const draftOf = (r: CatalogRecord): Draft => ({
  title: r.title,
  description: r.description,
  placeCategory: r.placeCategory,
  address: r.address,
  phone: r.phone,
  websiteUrl: r.websiteUrl,
  venueName: r.venueName,
  startsAt: r.startsAt,
  endsAt: r.endsAt,
  transportMode: r.transportMode,
  travelMinutes: r.travelMinutes,
  links: r.links,
  fieldSources: r.fieldSources,
  seasons: r.seasons,
  openingHours: r.openingHours,
  images: r.images,
});

/** The Details section's body for the record's kind. */
function detailsBody(kind: CatalogKind, d: Draft, location: LatLng | null): CatalogRecordPatch {
  switch (kind) {
    case 'place':
      return {
        placeCategory: d.placeCategory ?? 'restaurant',
        location,
        address: d.address,
        phone: d.phone,
        websiteUrl: d.websiteUrl,
      };
    case 'event':
      return {
        startsAt: d.startsAt ?? '',
        endsAt: d.endsAt ?? '',
        location,
        venueName: d.venueName,
        websiteUrl: d.websiteUrl,
      };
    case 'transport_note':
      return { transportMode: d.transportMode ?? 'other' };
    case 'day_trip':
      return { travelMinutes: d.travelMinutes ?? 0, location, websiteUrl: d.websiteUrl };
  }
}

const day = (iso: string) => new Date(iso).toLocaleDateString();

/** /admin/catalog/records/:id */
export function RecordPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [record, setRecord] = useState<CatalogRecord | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [coords, setCoords] = useState<Coords>({ lat: null, lng: null });

  /** Takes a saved record; only `keys` of the draft are replaced, so other sections keep edits. */
  const accept = useCallback((saved: CatalogRecord, keys: readonly (keyof Draft)[] | 'all') => {
    setRecord(saved);
    if (keys === 'all') {
      setDraft(draftOf(saved));
      setCoords(coordsOf(saved.location));
      return;
    }
    const fresh = draftOf(saved);
    setDraft((d) => {
      if (!d) return fresh;
      const next = { ...d };
      for (const key of keys) (next as Record<string, unknown>)[key] = fresh[key];
      return next;
    });
  }, []);

  useEffect(() => {
    void run(async () => accept(await catalog.record(id), 'all'));
  }, [id, run, accept]);

  // The chips and the translations panel follow the job; drafts are left alone.
  usePendingRefresh(record ? [record] : [], async () => setRecord(await catalog.record(id)));

  if (!record || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const { kind } = record;
  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  const saveDetails = async () => {
    const saved = await catalog.updateRecord(id, detailsBody(kind, draft, locationOf(coords)));
    accept(saved, [
      'placeCategory',
      'address',
      'phone',
      'websiteUrl',
      'venueName',
      'startsAt',
      'endsAt',
      'transportMode',
      'travelMinutes',
    ]);
    setCoords(coordsOf(saved.location));
  };

  const savePatch = (keys: readonly (keyof Draft)[], body: CatalogRecordPatch) => async () =>
    accept(await catalog.updateRecord(id, body), keys);

  const reload = async () => setRecord(await catalog.record(id));

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
        <Link to={`/admin/catalog/destinations/${record.destination.id}`}>
          {record.destination.name}
        </Link>
      </nav>
      <div className="page-head">
        <h1>{record.title}</h1>
        <div className="record-chips">
          <span className="chip neutral">{CATALOG_KIND_LABELS[kind]}</span>
          <StalenessChip staleness={record.staleness} />
          <TranslationChip status={record.translation.status} />
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        <Section title="Details" onSave={saveDetails}>
          {kind === 'place' ? (
            <>
              <SelectField
                label="Category"
                value={draft.placeCategory}
                options={PLACE_CATEGORIES}
                labels={PLACE_CATEGORY_LABELS}
                onChange={(c) => c && set('placeCategory')(c)}
              />
              <TextField
                label="Address"
                value={draft.address}
                maxLength={LIMITS.shortText}
                onChange={set('address')}
              />
              <TextField
                label="Phone"
                type="tel"
                value={draft.phone}
                maxLength={LIMITS.phone}
                onChange={set('phone')}
              />
            </>
          ) : null}
          {kind === 'event' ? (
            <>
              <div className="field-row">
                <InputField
                  label="Starts"
                  type="datetime-local"
                  value={draft.startsAt}
                  required
                  onChange={set('startsAt')}
                />
                <InputField
                  label="Ends"
                  type="datetime-local"
                  value={draft.endsAt}
                  required
                  onChange={set('endsAt')}
                />
              </div>
              <small>
                {EVENT_TIME_HINT} ({record.destination.timezone})
              </small>
              <TextField
                label="Venue"
                value={draft.venueName}
                maxLength={LIMITS.shortText}
                onChange={set('venueName')}
              />
            </>
          ) : null}
          {kind === 'transport_note' ? (
            <SelectField
              label="Mode"
              value={draft.transportMode}
              options={TRANSPORT_MODES}
              labels={TRANSPORT_MODE_LABELS}
              onChange={(m) => m && set('transportMode')(m)}
            />
          ) : null}
          {kind === 'day_trip' ? (
            <NumberField
              label="Travel time (minutes)"
              hint="One way, from the destination."
              value={draft.travelMinutes}
              min={1}
              max={CATALOG_LIMITS.travelMinutesMax}
              onChange={set('travelMinutes')}
            />
          ) : null}
          {kind !== 'transport_note' ? (
            <>
              <CoordsFields value={coords} onChange={setCoords} />
              <InputField
                label="Website"
                type="url"
                placeholder="https://"
                value={draft.websiteUrl}
                maxLength={CATALOG_LIMITS.url}
                onChange={set('websiteUrl')}
              />
            </>
          ) : null}
        </Section>

        <Section
          title="Description"
          description="Saving a change to the title or description translates it again into the seven guest languages."
          onSave={savePatch(['title', 'description'], {
            title: draft.title,
            description: draft.description,
          })}
        >
          <TextField
            label="Title"
            value={draft.title}
            maxLength={LIMITS.title}
            required
            onChange={(v) => set('title')(v ?? '')}
          />
          <TextArea
            label="Description"
            hint="Markdown."
            value={draft.description}
            maxLength={LIMITS.blockBody}
            rows={8}
            required
            monospace
            onChange={(v) => set('description')(v ?? '')}
          />
        </Section>

        {KIND_HAS_SEASONS[kind] ? (
          <Section
            title="Seasons"
            onSave={async () => accept(await catalog.setSeasons(id, draft.seasons), ['seasons'])}
          >
            <SeasonsEditor seasons={draft.seasons} onChange={set('seasons')} />
          </Section>
        ) : null}

        {KIND_HAS_HOURS[kind] ? (
          <Section
            title="Opening hours"
            onSave={async () =>
              accept(await catalog.setOpeningHours(id, draft.openingHours), ['openingHours'])
            }
          >
            <OpeningHoursEditor hours={draft.openingHours} onChange={set('openingHours')} />
          </Section>
        ) : null}

        {kind === 'transport_note' ? (
          <Section title="Links" onSave={savePatch(['links'], { links: draft.links })}>
            <LinksEditor links={draft.links} onChange={set('links')} />
          </Section>
        ) : null}

        {kind === 'place' ? (
          <Section
            title="Photos"
            onSave={async () => accept(await catalog.setImages(id, draft.images), ['images'])}
          >
            <ImagesEditor images={draft.images} onChange={set('images')} />
          </Section>
        ) : null}

        <Section
          title="Sources"
          description="Where each fact was checked. One https link per field."
          onSave={savePatch(['fieldSources'], { fieldSources: draft.fieldSources })}
        >
          <SourcesEditor kind={kind} sources={draft.fieldSources} onChange={set('fieldSources')} />
        </Section>

        <Section title="Translations">
          <CatalogTranslations record={record} onChanged={reload} />
        </Section>

        <section className="panel">
          <h2>Verification</h2>
          <p>
            {record.verifiedAt
              ? `Last verified ${day(record.verifiedAt)} by ${record.verifiedByEmail ?? 'the seed script'}.`
              : 'Never verified.'}
            {record.staleness.staleAt
              ? ` ${record.staleness.status === 'stale' ? 'Went' : 'Goes'} past its budget on ${day(record.staleness.staleAt)}.`
              : null}
          </p>
          <p className="muted">Stamps today's date on the whole record. Check every field first.</p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void run(async () => setRecord(await catalog.verify(id)))}
            >
              Mark verified
            </button>
          </div>
        </section>

        <section className="panel danger-zone">
          <h2>Delete record</h2>
          <p className="muted">
            Deletes the record with its seasons, hours, photos and translations.
          </p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete ${record.title}? This cannot be undone.`)) {
                void run(async () => {
                  await catalog.deleteRecord(id);
                  navigate(`/admin/catalog/destinations/${record.destination.id}`, {
                    replace: true,
                  });
                });
              }
            }}
          >
            Delete record
          </button>
        </section>
      </div>
    </>
  );
}
