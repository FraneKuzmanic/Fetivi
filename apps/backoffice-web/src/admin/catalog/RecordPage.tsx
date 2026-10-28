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
import { useTranslation } from 'react-i18next';
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
import { MapPicker, noLocation } from '../../forms/MapPicker';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useLabels } from '../../i18n/useLabels';
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

/** The record's point on the map; a picked search result also fills an empty address. */
function LocationPicker({
  value,
  onChange,
  onAddress,
  required,
}: {
  value: Coords;
  onChange: (c: Coords) => void;
  /** Where the record has an address field: called with the picked place's address. */
  onAddress?: (address: string) => void;
  required?: boolean;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  return (
    <MapPicker
      label={t('record.mapLocation')}
      value={value}
      onChange={onChange}
      required={required}
      search={{
        label: t('record.findPlace'),
        placeholder: t('record.nameOrAddress'),
        kind: 'address',
        onPick: onAddress ? (place) => onAddress(place.addressLine ?? place.label) : undefined,
      }}
    />
  );
}

/** Ticked lines, kept in table order. */
function FerryLinesField({
  value,
  onChange,
}: {
  value: readonly string[];
  onChange: (lines: string[]) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const toggle = (id: string, on: boolean) =>
    onChange(FERRY_LINES.map((l) => l.id).filter((l) => (l === id ? on : value.includes(l))));
  return (
    <fieldset className="row-editor check-group">
      <legend>{t('record.ferryLines')}</legend>
      <small className="muted">{t('record.ferryHint')}</small>
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

/** Places and day trips: one box, for the daily tips' rain rule. */
function RainyDayField({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  return (
    <fieldset className="row-editor check-group">
      <legend>{t('record.dailyTips')}</legend>
      <small className="muted">{t('record.rainyHint')}</small>
      <CheckboxField label={t('record.rainy')} checked={value} onChange={onChange} />
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
  const { t } = useTranslation(['admin', 'common', 'host']);
  const toggle = (code: string, on: boolean) =>
    onChange(INTERESTS.filter((c) => (c === code ? on : value.includes(c))));
  return (
    <fieldset className="row-editor check-group">
      <legend>{t('record.suits')}</legend>
      <small className="muted">{t('record.suitsHint')}</small>
      {INTERESTS.map((code) => (
        <CheckboxField
          key={code}
          label={t(`record.interests.${code as Interest}`)}
          checked={value.includes(code)}
          onChange={(on) => toggle(code, on)}
        />
      ))}
    </fieldset>
  );
}

/** /admin/catalog/destinations/:id/new/:kind: the kind's required fields, then the full editor. */
export function NewRecordPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { id = '', kind: kindParam = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [placeCategory, setPlaceCategory] = useState<PlaceCategory>('restaurant');
  const [transportMode, setTransportMode] = useState<TransportMode>('bus');
  const [coords, setCoords] = useState<Coords>({ lat: null, lng: null });
  const [address, setAddress] = useState<string | null>(null);
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
      ? t(`record.addKind.${kindParam as CatalogKind}`)
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
          address,
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
      if (kind === 'place' && locationOf(coords) === null) throw new Error(noLocation());
      const created = await catalog.createRecord(id, body());
      navigate(`/admin/catalog/records/${created.id}`, { replace: true });
    });
  }

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/catalog">{t('catalog.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/admin/catalog/destinations/${id}`}>
          {destinationName ?? t('catalog.destination')}
        </Link>
      </nav>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label={t('record.title')}
              value={title}
              maxLength={LIMITS.title}
              required
              onChange={setTitle}
            />
            <TextArea
              label={t('record.description')}
              hint={t('record.descriptionHint')}
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
                  label={t('record.category')}
                  value={placeCategory}
                  options={PLACE_CATEGORIES}
                  labels={labels.placeCategory}
                  onChange={(c) => c && setPlaceCategory(c)}
                />
                <LocationPicker value={coords} onChange={setCoords} required />
              </>
            ) : null}
            {kind === 'event' ? (
              <div className="field-row">
                <InputField
                  label={t('record.starts')}
                  type="datetime-local"
                  value={startsAt}
                  required
                  onChange={setStartsAt}
                />
                <InputField
                  label={t('record.ends')}
                  type="datetime-local"
                  value={endsAt}
                  required
                  onChange={setEndsAt}
                />
              </div>
            ) : null}
            {kind === 'event' ? (
              <>
                <small>{t('record.eventTimeHint')}</small>
                <TextField
                  label={t('record.address')}
                  hint={t('record.optional')}
                  value={address}
                  maxLength={LIMITS.shortText}
                  onChange={setAddress}
                />
                <LocationPicker
                  value={coords}
                  onChange={setCoords}
                  onAddress={(a) => setAddress((now) => now ?? a)}
                />
              </>
            ) : null}
            {kind === 'transport_note' ? (
              <SelectField
                label={t('record.mode')}
                value={transportMode}
                options={TRANSPORT_MODES}
                labels={labels.transportMode}
                onChange={(m) => m && setTransportMode(m)}
              />
            ) : null}
            {kind === 'day_trip' ? (
              <>
                <NumberField
                  label={t('record.travelTime')}
                  hint={t('record.travelHint')}
                  value={travelMinutes}
                  min={1}
                  max={CATALOG_LIMITS.travelMinutesMax}
                  onChange={setTravelMinutes}
                />
                <LocationPicker value={coords} onChange={setCoords} />
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
              Create {labels.catalogKind[kind].toLowerCase()}
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
        address: d.address,
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
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
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
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
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
      title: t('record.verifyTitle', { title: record.title }),
      body: t('record.verifyBody'),
      action: t('record.markVerified'),
    });
    if (yes) void run(async () => setRecord(await catalog.verify(id)));
  }

  async function remove() {
    if (!record) return;
    const yes = await confirm({
      title: t('record.deleteTitle', { title: record.title }),
      body: t('record.deleteBody'),
      action: t('record.deleteRecord'),
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      await catalog.deleteRecord(id);
      navigate(`/admin/catalog/destinations/${record.destination.id}`, { replace: true });
    });
  }

  const sections: PageSection[] = [
    { id: 'details', label: t('record.details'), icon: Info },
    { id: 'description', label: t('record.description'), icon: TextAlignLeft },
    ...(KIND_HAS_SEASONS[kind]
      ? [
          {
            id: 'seasons',
            label: t('record.seasons'),
            icon: CalendarBlank,
            count: draft.seasons.length,
          },
        ]
      : []),
    ...(KIND_HAS_HOURS[kind]
      ? [{ id: 'hours', label: t('record.hours'), icon: Clock, count: draft.openingHours.length }]
      : []),
    ...(kind === 'transport_note'
      ? [{ id: 'links', label: t('record.links'), icon: LinkSimple }]
      : []),
    ...(kind === 'place'
      ? [{ id: 'photos', label: t('record.photos'), icon: ImageSquare, count: draft.images.length }]
      : []),
    { id: 'sources', label: t('record.sources'), icon: BookOpen },
    { id: 'translations', label: t('record.translations'), icon: Translate },
  ];

  const renderSection = (section: string) => {
    switch (section) {
      case 'description':
        return (
          <Section
            title={t('record.description')}
            onSave={savePatch(['title', 'description'], {
              title: draft.title,
              description: draft.description,
            })}
          >
            <TextField
              label={t('record.title')}
              value={draft.title}
              maxLength={LIMITS.title}
              required
              onChange={(v) => set('title')(v ?? '')}
            />
            <TextArea
              label={t('record.description')}
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
            title={t('record.seasons')}
            onSave={async () => accept(await catalog.setSeasons(id, draft.seasons), ['seasons'])}
          >
            <SeasonsEditor seasons={draft.seasons} onChange={set('seasons')} />
          </Section>
        );
      case 'hours':
        return (
          <Section
            title={t('record.hours')}
            onSave={async () =>
              accept(await catalog.setOpeningHours(id, draft.openingHours), ['openingHours'])
            }
          >
            <OpeningHoursEditor hours={draft.openingHours} onChange={set('openingHours')} />
          </Section>
        );
      case 'links':
        return (
          <Section title={t('record.links')} onSave={savePatch(['links'], { links: draft.links })}>
            <LinksEditor links={draft.links} onChange={set('links')} />
          </Section>
        );
      case 'photos':
        return (
          <Section
            title={t('record.photos')}
            onSave={async () => accept(await catalog.setImages(id, draft.images), ['images'])}
          >
            <ImagesEditor images={draft.images} onChange={set('images')} />
          </Section>
        );
      case 'sources':
        return (
          <Section
            title={t('record.sources')}
            description={t('record.sourcesHint')}
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
          <Section title={t('record.translations')}>
            <CatalogTranslations record={record} onChanged={reload} />
          </Section>
        );
      default:
        return (
          <Section title={t('record.details')} onSave={saveDetails}>
            {kind === 'place' ? (
              <>
                <SelectField
                  label={t('record.category')}
                  value={draft.placeCategory}
                  options={PLACE_CATEGORIES}
                  labels={labels.placeCategory}
                  onChange={(c) => c && set('placeCategory')(c)}
                />
                <TextField
                  label={t('record.address')}
                  value={draft.address}
                  maxLength={LIMITS.shortText}
                  onChange={set('address')}
                />
                <TextField
                  label={t('record.phone')}
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
                    label={t('record.starts')}
                    type="datetime-local"
                    value={draft.startsAt}
                    required
                    onChange={set('startsAt')}
                  />
                  <InputField
                    label={t('record.ends')}
                    type="datetime-local"
                    value={draft.endsAt}
                    required
                    onChange={set('endsAt')}
                  />
                </div>
                <small>
                  {t('record.eventTimeHintZone', { zone: record.destination.timezone })}
                </small>
                <TextField
                  label={t('record.venue')}
                  value={draft.venueName}
                  maxLength={LIMITS.shortText}
                  onChange={set('venueName')}
                />
                <TextField
                  label={t('record.address')}
                  hint={t('record.optional')}
                  value={draft.address}
                  maxLength={LIMITS.shortText}
                  onChange={set('address')}
                />
              </>
            ) : null}
            {kind === 'transport_note' ? (
              <SelectField
                label={t('record.mode')}
                value={draft.transportMode}
                options={TRANSPORT_MODES}
                labels={labels.transportMode}
                onChange={(m) => m && set('transportMode')(m)}
              />
            ) : null}
            {kind === 'day_trip' ? (
              <NumberField
                label={t('record.travelTime')}
                hint={t('record.travelHint')}
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
                <LocationPicker
                  value={coords}
                  onChange={setCoords}
                  onAddress={
                    kind === 'day_trip'
                      ? undefined
                      : (a) => setDraft((d) => (d && d.address === null ? { ...d, address: a } : d))
                  }
                />
                <InputField
                  label={t('record.website')}
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
      ? record.verifiedByEmail
        ? t('record.verifiedBy', { day: day(record.verifiedAt), email: record.verifiedByEmail })
        : t('record.verified', { day: day(record.verifiedAt) })
      : t('record.neverVerified'),
    record.staleness.staleAt
      ? record.staleness.status === 'stale'
        ? t('record.dueSince', { day: day(record.staleness.staleAt) })
        : t('record.nextDue', { day: day(record.staleness.staleAt) })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/catalog">{t('catalog.title')}</Link>
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
            {labels.catalogKind[kind]} · {verifiedLine}
          </p>
        </div>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void verify()}>
            <SealCheck aria-hidden="true" />
            {t('record.markVerified')}
          </button>
          <MoreActions
            label={t('record.moreActions', { title: record.title })}
            items={[
              {
                label: t('record.deleteRecord'),
                icon: <Trash aria-hidden="true" />,
                danger: true,
                onSelect: () => void remove(),
              },
            ]}
          />
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <SectionLayout sections={sections} label={t('record.sections')} render={renderSection} />
    </>
  );
}
