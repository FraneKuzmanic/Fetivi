import { INTERESTS, type Interest } from '@fetivi/domain/about-me-vocabulary';
import { FERRY_LINES, FERRY_OPERATOR_INFO } from '@fetivi/domain/alerts-vocabulary';
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
import {
  BookOpen,
  CalendarBlank,
  Clock,
  ImageSquare,
  Info,
  LinkSimple,
  SealCheck,
  TextAlignLeft,
  Translate,
  Trash,
} from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  type CatalogRecord,
  type CatalogRecordInput,
  type CatalogRecordPatch,
  catalog,
  type LatLng,
} from '../../api';
import {
  CheckboxField,
  NumberField,
  Section,
  SelectField,
  TextArea,
  TextField,
} from '../../forms/fields';
import {
  CATALOG_KIND_LABELS,
  PLACE_CATEGORY_LABELS,
  TRANSPORT_MODE_LABELS,
} from '../../forms/labels';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useConfirm } from '../../shell/ConfirmDialog';
import { MoreActions } from '../../shell/MoreActions';
import { usePageTitle } from '../../shell/PageTitle';
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
import { day, StalenessChip } from './StalenessChip';

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

/** Ticked lines, kept in table order. */
function FerryLinesField({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (lines: string[]) => void;
}) {
  const toggle = (id: string, on: boolean) =>
    onChange(FERRY_LINES.map((l) => l.id).filter((l) => (l === id ? on : value.includes(l))));
  return (
    <fieldset className="row-editor check-group">
      <legend>Ferry and catamaran lines</legend>
      <small className="muted">
        Guests get Jadrolinija notices and wind advisories for these lines.
      </small>
      {FERRY_LINES.map((line) => (
        <CheckboxField
          key={line.id}
          label={`${/^\d+$/.test(line.id) ? `${line.id} ` : ''}${line.route} · ${FERRY_OPERATOR_INFO[line.operator].name}`}
          checked={value.includes(line.id)}
          onChange={(on) => toggle(line.id, on)}
        />
      ))}
    </fieldset>
  );
}

const INTEREST_LABELS: Record<Interest, string> = {
  beaches: 'Beaches & swimming',
  sights: 'History & sights',
  food: 'Food & wine',
  nature: 'Nature & walks',
  day_trips: 'Boat & day trips',
  active: 'Sport & activities',
  nightlife: 'Nightlife',
  shopping: 'Markets & shopping',
  slow: 'Slow days',
};

/** Places and day trips: one box, for the daily tips' rain rule. */
function RainyDayField({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  return (
    <fieldset className="row-editor check-group">
      <legend>Daily tips</legend>
      <small className="muted">Daily tips suggest it when rain is forecast.</small>
      <CheckboxField label="Good on a rainy day" checked={value} onChange={onChange} />
    </fieldset>
  );
}

/** Events: ticked About me interests, kept in their display order. */
function InterestsField({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (interests: string[]) => void;
}) {
  const toggle = (code: string, on: boolean) =>
    onChange(INTERESTS.filter((c) => (c === code ? on : value.includes(c))));
  return (
    <fieldset className="row-editor check-group">
      <legend>Suits guests who like</legend>
      <small className="muted">Daily tips suggest the event to guests with these interests.</small>
      {INTERESTS.map((code) => (
        <CheckboxField
          key={code}
          label={INTEREST_LABELS[code]}
          checked={value.includes(code)}
          onChange={(on) => toggle(code, on)}
        />
      ))}
    </fieldset>
  );
}

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
  const [ferryLines, setFerryLines] = useState<string[]>([]);
  const [rainyDay, setRainyDay] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [destinationName, setDestinationName] = useState<string | null>(null);

  useEffect(() => {
    catalog
      .destination(id)
      .then((d) => setDestinationName(d.name))
      .catch(() => {});
  }, [id]);

  usePageTitle(
    (CATALOG_KINDS as readonly string[]).includes(kindParam)
      ? `Add ${CATALOG_KIND_LABELS[kindParam as CatalogKind].toLowerCase()}`
      : undefined,
  );

  if (!(CATALOG_KINDS as readonly string[]).includes(kindParam)) {
    return <Navigate to={`/admin/catalog/destinations/${id}`} replace />;
  }
  const kind = kindParam as CatalogKind;

  function body(): CatalogRecordInput {
    const text = { title: title ?? '', description: description ?? '' };
    const location = locationOf(coords);
    switch (kind) {
      case 'place':
        return { kind, ...text, placeCategory, location: location as LatLng, rainyDay };
      case 'event':
        return {
          kind,
          ...text,
          startsAt: startsAt ?? '',
          endsAt: endsAt ?? '',
          location,
          interests,
        };
      case 'transport_note':
        return { kind, ...text, transportMode, ferryLines };
      case 'day_trip':
        return {
          kind,
          ...text,
          travelMinutes: travelMinutes ?? 0,
          location,
          ferryLines,
          rainyDay,
        };
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
        <span aria-hidden="true">/</span>
        <Link to={`/admin/catalog/destinations/${id}`}>{destinationName ?? 'Destination'}</Link>
      </nav>
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
            {kind === 'day_trip' || kind === 'transport_note' ? (
              <FerryLinesField value={ferryLines} onChange={setFerryLines} />
            ) : null}
            {kind === 'place' || kind === 'day_trip' ? (
              <RainyDayField value={rainyDay} onChange={setRainyDay} />
            ) : null}
            {kind === 'event' ? <InterestsField value={interests} onChange={setInterests} /> : null}
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
  | 'ferryLines'
  | 'rainyDay'
  | 'interests'
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
  ferryLines: r.ferryLines,
  rainyDay: r.rainyDay,
  interests: r.interests,
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
        rainyDay: d.rainyDay,
      };
    case 'event':
      return {
        startsAt: d.startsAt ?? '',
        endsAt: d.endsAt ?? '',
        location,
        venueName: d.venueName,
        websiteUrl: d.websiteUrl,
        interests: d.interests,
      };
    case 'transport_note':
      return { transportMode: d.transportMode ?? 'other', ferryLines: d.ferryLines };
    case 'day_trip':
      return {
        travelMinutes: d.travelMinutes ?? 0,
        location,
        websiteUrl: d.websiteUrl,
        ferryLines: d.ferryLines,
        rainyDay: d.rainyDay,
      };
  }
}

/** /admin/catalog/records/:id */
export function RecordPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
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

  usePageTitle(record?.title);

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
      'ferryLines',
      'rainyDay',
      'interests',
    ]);
    setCoords(coordsOf(saved.location));
  };

  const savePatch = (keys: readonly (keyof Draft)[], body: CatalogRecordPatch) => async () =>
    accept(await catalog.updateRecord(id, body), keys);

  const reload = async () => setRecord(await catalog.record(id));

  async function verify() {
    if (!record) return;
    const yes = await confirm({
      title: `Mark ${record.title} as verified?`,
      body: 'Check every field first. This sets today as the last-checked date for the whole record.',
      action: 'Mark verified',
    });
    if (yes) void run(async () => setRecord(await catalog.verify(id)));
  }

  async function remove() {
    if (!record) return;
    const yes = await confirm({
      title: `Delete ${record.title}?`,
      body: 'Its seasons, hours, photos and translations go with it. This cannot be undone.',
      action: 'Delete record',
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      await catalog.deleteRecord(id);
      navigate(`/admin/catalog/destinations/${record.destination.id}`, { replace: true });
    });
  }

  const sections: PageSection[] = [
    { id: 'details', label: 'Details', icon: Info },
    { id: 'description', label: 'Description', icon: TextAlignLeft },
    ...(KIND_HAS_SEASONS[kind]
      ? [{ id: 'seasons', label: 'Seasons', icon: CalendarBlank, count: draft.seasons.length }]
      : []),
    ...(KIND_HAS_HOURS[kind]
      ? [{ id: 'hours', label: 'Opening hours', icon: Clock, count: draft.openingHours.length }]
      : []),
    ...(kind === 'transport_note' ? [{ id: 'links', label: 'Links', icon: LinkSimple }] : []),
    ...(kind === 'place'
      ? [{ id: 'photos', label: 'Photos', icon: ImageSquare, count: draft.images.length }]
      : []),
    { id: 'sources', label: 'Sources', icon: BookOpen },
    { id: 'translations', label: 'Translations', icon: Translate },
  ];

  const renderSection = (section: string) => {
    switch (section) {
      case 'description':
        return (
          <Section
            title="Description"
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
              value={draft.description}
              maxLength={LIMITS.blockBody}
              rows={8}
              required
              onChange={(v) => set('description')(v ?? '')}
            />
          </Section>
        );
      case 'seasons':
        return (
          <Section
            title="Seasons"
            onSave={async () => accept(await catalog.setSeasons(id, draft.seasons), ['seasons'])}
          >
            <SeasonsEditor seasons={draft.seasons} onChange={set('seasons')} />
          </Section>
        );
      case 'hours':
        return (
          <Section
            title="Opening hours"
            onSave={async () =>
              accept(await catalog.setOpeningHours(id, draft.openingHours), ['openingHours'])
            }
          >
            <OpeningHoursEditor hours={draft.openingHours} onChange={set('openingHours')} />
          </Section>
        );
      case 'links':
        return (
          <Section title="Links" onSave={savePatch(['links'], { links: draft.links })}>
            <LinksEditor links={draft.links} onChange={set('links')} />
          </Section>
        );
      case 'photos':
        return (
          <Section
            title="Photos"
            onSave={async () => accept(await catalog.setImages(id, draft.images), ['images'])}
          >
            <ImagesEditor images={draft.images} onChange={set('images')} />
          </Section>
        );
      case 'sources':
        return (
          <Section
            title="Sources"
            description="Where each fact was checked. One https link per field."
            onSave={savePatch(['fieldSources'], { fieldSources: draft.fieldSources })}
          >
            <SourcesEditor
              kind={kind}
              sources={draft.fieldSources}
              onChange={set('fieldSources')}
            />
          </Section>
        );
      case 'translations':
        return (
          <Section title="Translations">
            <CatalogTranslations record={record} onChanged={reload} />
          </Section>
        );
      default:
        return (
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
            {kind === 'day_trip' || kind === 'transport_note' ? (
              <FerryLinesField value={draft.ferryLines} onChange={set('ferryLines')} />
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
            {kind === 'place' || kind === 'day_trip' ? (
              <RainyDayField value={draft.rainyDay} onChange={set('rainyDay')} />
            ) : null}
            {kind === 'event' ? (
              <InterestsField value={draft.interests} onChange={set('interests')} />
            ) : null}
          </Section>
        );
    }
  };

  const verifiedLine = [
    record.verifiedAt
      ? `Verified ${day(record.verifiedAt)}${record.verifiedByEmail ? ` by ${record.verifiedByEmail}` : ''}`
      : 'Never verified',
    record.staleness.staleAt
      ? `${record.staleness.status === 'stale' ? 'Re-check due since' : 'Next re-check'} ${day(record.staleness.staleAt)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/admin/catalog/destinations/${record.destination.id}`}>
          {record.destination.name}
        </Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            {record.staleness.status === 'fresh' ? null : (
              <StalenessChip staleness={record.staleness} />
            )}
            <TranslationChip status={record.translation.status} />
          </div>
          <p className="muted">
            {CATALOG_KIND_LABELS[kind]} · {verifiedLine}
          </p>
        </div>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void verify()}>
            <SealCheck aria-hidden="true" />
            Mark verified
          </button>
          <MoreActions
            label={`More actions for ${record.title}`}
            items={[
              {
                label: 'Delete record',
                icon: <Trash aria-hidden="true" />,
                danger: true,
                onSelect: () => void remove(),
              },
            ]}
          />
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <SectionLayout sections={sections} label="Record sections" render={renderSection} />
    </>
  );
}
