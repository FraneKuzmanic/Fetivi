import { CATALOG_KINDS, type CatalogKind } from '@fetivi/domain/catalog-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import {
  ArrowsClockwise,
  CaretDown,
  ListBullets,
  MagnifyingGlass,
  MapPin,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import {
  type CatalogRecordSummary,
  catalog,
  type Destination,
  type DestinationInput,
  type DraftingStatus,
  drafting,
} from '../../api';
import { formatDate, formatMoment } from '../../forms/datetime';
import { NumberField, Section, TextField } from '../../forms/fields';
import { MapPicker } from '../../forms/MapPicker';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { i18next } from '../../i18n';
import { currentLabels, useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { EmptyState } from '../../shell/EmptyState';
import { Menu } from '../../shell/Menu';
import { MoreActions } from '../../shell/MoreActions';
import { usePageTitle } from '../../shell/PageTitle';
import { Tabs } from '../../shell/Tabs';
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
  const { t } = useTranslation(['admin', 'common', 'host']);
  const set =
    <K extends keyof AreaDraft>(key: K) =>
    (value: AreaDraft[K]) =>
      onChange({ ...draft, [key]: value });
  const zones = ZONES.includes(draft.timezone) ? ZONES : [draft.timezone, ...ZONES];
  return (
    <>
      <TextField
        label={t('catalog.name')}
        hint={t('catalog.nameHint')}
        value={draft.name}
        maxLength={LIMITS.name}
        required
        onChange={set('name')}
      />
      <div className="field-row">
        <NumberField
          label={t('catalog.radius')}
          value={draft.radiusKm}
          min={1}
          max={100}
          step="any"
          onChange={set('radiusKm')}
        />
        <label className="field">
          <span className="field-label">{t('catalog.timeZone')}</span>
          <select value={draft.timezone} onChange={(e) => set('timezone')(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>
      <MapPicker
        label={t('catalog.centre')}
        value={{ lat: draft.lat, lng: draft.lng }}
        onChange={(p) => onChange({ ...draft, ...p })}
        search={{
          label: t('catalog.findTown'),
          placeholder: t('catalog.townPlaceholder'),
          kind: 'settlement',
        }}
        radiusKm={draft.radiusKm}
      />
    </>
  );
}

/** /admin/catalog/destinations/new */
export function NewDestinationPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
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

  usePageTitle(t('catalog.addDestination'));

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/catalog">{t('catalog.title')}</Link>
      </nav>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <AreaFields draft={draft} onChange={setDraft} />
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {t('catalog.create')}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

type Tab = 'all' | CatalogKind;
const tabs = (): { id: Tab; label: string; empty: string }[] => [
  { id: 'all', label: i18next.t('admin:catalog.all'), empty: i18next.t('admin:catalog.noRecords') },
  {
    id: 'place',
    label: i18next.t('admin:catalog.places'),
    empty: i18next.t('admin:catalog.noPlaces'),
  },
  {
    id: 'event',
    label: i18next.t('admin:catalog.events'),
    empty: i18next.t('admin:catalog.noEvents'),
  },
  {
    id: 'transport_note',
    label: i18next.t('admin:catalog.transport'),
    empty: i18next.t('admin:catalog.noTransport'),
  },
  {
    id: 'day_trip',
    label: i18next.t('admin:catalog.dayTrips'),
    empty: i18next.t('admin:catalog.noDayTrips'),
  },
];

const recordCount = (n: number) => i18next.t('admin:catalog.recordCount', { count: n });

/** /admin/catalog/destinations/:id: its records, the website check and the area, a section each. */
export function DestinationPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const _labels = useLabels();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { error, run } = useAction();
  const [destination, setDestination] = useState<Destination | null>(null);
  const [draft, setDraft] = useState<AreaDraft | null>(null);
  const [records, setRecords] = useState<CatalogRecordSummary[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

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

  usePageTitle(destination?.name);

  if (!destination || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  }

  const saveArea = async () => {
    const saved = await catalog.updateDestination(id, inputOf(draft));
    setDestination(saved);
    setDraft(draftOf(saved));
  };

  const count = records?.length ?? destination.recordCount;

  async function remove() {
    if (!destination) return;
    if (count > 0) {
      setBlocked(t('catalog.deleteBlocked', { name: destination.name, count }));
      return;
    }
    const yes = await confirm({
      title: t('catalog.deleteTitle', { name: destination.name }),
      body: t('catalog.deleteBody'),
      action: t('catalog.deleteDestination'),
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      await catalog.deleteDestination(id);
      navigate('/admin/catalog', { replace: true });
    });
  }

  const sections: PageSection[] = [
    { id: 'records', label: t('catalog.records'), icon: ListBullets, count },
    { id: 'refresh', label: t('catalog.websiteCheck'), icon: ArrowsClockwise },
    { id: 'area', label: t('catalog.area'), icon: MapPin },
  ];

  const renderSection = (section: string) => {
    if (section === 'refresh') return <RefreshPanel destinationId={id} />;
    if (section === 'area') {
      return (
        <Section title={t('catalog.area')} description={t('catalog.areaHint')} onSave={saveArea}>
          <AreaFields draft={draft} onChange={setDraft} />
        </Section>
      );
    }
    return <RecordsPanel destinationId={id} records={records} />;
  };

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/catalog">{t('catalog.title')}</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <p className="muted">
            {t('catalog.within', { km: destination.radiusKm })} · {recordCount(count)}
          </p>
        </div>
        <div className="actions">
          <Link className="button" to={`/admin/catalog/destinations/${id}/seeding`}>
            <MagnifyingGlass aria-hidden="true" />
            {t('catalog.findPlaces')}
          </Link>
          <MoreActions
            label={t('catalog.moreActions', { name: destination.name })}
            items={[
              {
                label: t('catalog.deleteDestination'),
                icon: <Trash aria-hidden="true" />,
                danger: true,
                onSelect: () => void remove(),
              },
            ]}
          />
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {blocked ? <p role="alert">{blocked}</p> : null}

      <SectionLayout sections={sections} label={t('catalog.sections')} render={renderSection} />
    </>
  );
}

function recordLine(r: CatalogRecordSummary): string {
  const labels = currentLabels();
  const kind = r.placeCategory ? labels.placeCategory[r.placeCategory] : labels.catalogKind[r.kind];
  if (r.kind !== 'event' || !r.startsAt || !r.endsAt) return kind;
  return i18next.t('admin:catalog.eventSpan', {
    kind,
    from: eventTime(r.startsAt),
    to: eventTime(r.endsAt),
  });
}

/** "2027-07-01T20:00" as "01.07.2027 20:00". */
const eventTime = (local: string) => {
  const [day = '', time = ''] = local.split('T');
  return `${formatDate(day)} ${time.slice(0, 5)}`.trim();
};

function RecordsPanel({
  destinationId,
  records,
}: {
  destinationId: string;
  records: CatalogRecordSummary[] | null;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const shown = records?.filter((r) => tab === 'all' || r.kind === tab) ?? null;
  const add = (kind: CatalogKind) =>
    navigate(`/admin/catalog/destinations/${destinationId}/new/${kind}`);
  const addable: readonly CatalogKind[] = tab === 'all' ? CATALOG_KINDS : [tab];

  return (
    <section className="panel" aria-labelledby="records-heading">
      <div className="panel-head">
        <h2 id="records-heading">{t('catalog.records')}</h2>
        {addable.length === 1 && addable[0] ? (
          <button type="button" className="primary" onClick={() => add(addable[0] as CatalogKind)}>
            <Plus aria-hidden="true" weight="bold" />
            Add {labels.catalogKind[addable[0]].toLowerCase()}
          </button>
        ) : (
          <Menu
            label={t('catalog.addRecord')}
            className="primary"
            trigger={
              <>
                <Plus aria-hidden="true" weight="bold" />
                {t('catalog.addRecordButton')}
                <CaretDown aria-hidden="true" />
              </>
            }
            items={addable.map((k) => ({
              label: labels.catalogKind[k],
              onSelect: () => add(k),
            }))}
          />
        )}
      </div>
      <Tabs label={t('catalog.kind')} items={tabs()} value={tab} onChange={setTab} />
      {shown === null ? <p className="muted">{t('common:loading')}</p> : null}
      {shown?.length === 0 ? (
        <EmptyState icon={ListBullets} title={tabs().find((x) => x.id === tab)?.empty ?? ''}>
          {tab === 'all' || tab === 'place' ? t('catalog.addHereOrFind') : t('catalog.addHere')}
        </EmptyState>
      ) : null}
      {shown && shown.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('catalog.name')}</th>
                <th scope="col" className="wide-only">
                  {t('catalog.kind')}
                </th>
                <th scope="col">{t('catalog.status')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="linked">
                  <td>
                    <Link className="row-target" to={`/admin/catalog/records/${r.id}`}>
                      {r.title}
                    </Link>
                  </td>
                  <td className="wide-only">{recordLine(r)}</td>
                  <td>
                    {r.staleness.status === 'fresh' && r.translation.status !== 'failed' ? (
                      <span className="muted">{t('catalog.upToDate')}</span>
                    ) : (
                      <span className="chip-stack">
                        {r.staleness.status === 'fresh' ? null : (
                          <StalenessChip staleness={r.staleness} />
                        )}
                        <TranslationChip status={r.translation.status} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

const dateTime = formatMoment;

/** "Last refresh 24 Oct 2026, 09:00: 3 Changes found, 20 No changes." */
function refreshLine(run: NonNullable<DraftingStatus['refresh']>): string {
  const counts = Object.entries(run.counts)
    .filter(([, n]) => n > 0)
    .map(([status, n]) =>
      i18next.t('admin:catalog.refreshCount', {
        status: currentLabels().draftingTaskStatus[status as keyof typeof run.counts],
        count: n,
      }),
    );
  return counts.length > 0
    ? i18next.t('admin:catalog.lastCheck', {
        when: dateTime(run.startedAt),
        counts: counts.join(', '),
      })
    : i18next.t('admin:catalog.lastCheckNothing', { when: dateTime(run.startedAt) });
}

/** The pre-season website check (42): re-drafts verified places and queues only what changed. */
function RefreshPanel({ destinationId }: { destinationId: string }) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { busy, error, run } = useAction();
  const [status, setStatus] = useState<DraftingStatus | null>(null);
  const [notice, setNotice] = useState<{ text: string; started: boolean } | null>(null);

  const load = useCallback(
    async () => setStatus(await drafting.status(destinationId)),
    [destinationId],
  );

  useEffect(() => {
    void run(load);
  }, [run, load]);

  const queued = status?.refresh?.counts.queued ?? 0;

  const start = () =>
    void run(async () => {
      setNotice(null);
      try {
        const started = await drafting.refresh(destinationId);
        setNotice(
          started.runId === null
            ? { text: t('catalog.noneDue'), started: false }
            : {
                text:
                  started.waiting > 0
                    ? t('catalog.checkingWaiting', {
                        count: started.queued,
                        waiting: started.waiting,
                      })
                    : t('catalog.checking', { count: started.queued }),
                started: true,
              },
        );
      } finally {
        await load();
      }
    });

  return (
    <section className="panel refresh-panel" aria-labelledby="refresh-heading">
      <h2 id="refresh-heading">{t('catalog.websiteCheck')}</h2>
      {status?.refresh ? <p>{refreshLine(status.refresh)}</p> : null}
      <div className="seeding-import">
        <button
          type="button"
          className="primary"
          disabled={busy || status === null || queued > 0 || status.refreshDue === 0}
          onClick={start}
        >
          {t('catalog.checkWebsites')}
        </button>
        {status ? (
          <span className="muted">
            {queued > 0
              ? t('catalog.running', { count: queued })
              : status.refreshDue === 0
                ? t('catalog.noneDueShort')
                : t('catalog.due', { count: status.refreshDue })}
          </span>
        ) : null}
      </div>
      {notice && !error ? (
        <output className="saved" aria-live="polite">
          {notice.text}{' '}
          {notice.started ? (
            <Link to="/admin/curation?kind=refresh_diff">{t('catalog.openChanges')}</Link>
          ) : null}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
