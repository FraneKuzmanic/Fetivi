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
import {
  CATALOG_KIND_LABELS,
  DRAFTING_TASK_STATUS_LABELS,
  PLACE_CATEGORY_LABELS,
} from '../../forms/labels';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
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
          hint="Copy the centre point from any map app."
          value={draft.lat}
          min={-90}
          max={90}
          step="any"
          onChange={set('lat')}
        />
        <NumberField
          label="Centre longitude"
          value={draft.lng}
          min={-180}
          max={180}
          step="any"
          onChange={set('lng')}
        />
      </div>
      <div className="field-row">
        <NumberField
          label="Area radius (km)"
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

  usePageTitle('Add destination');

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
      </nav>
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

const recordCount = (n: number) => (n === 1 ? '1 record' : `${n} records`);

/** /admin/catalog/destinations/:id: its records, the website check and the area, a section each. */
export function DestinationPage() {
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
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
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
      setBlocked(
        `To delete ${destination.name}, delete its ${recordCount(count)} first. Then you can delete the destination.`,
      );
      return;
    }
    const yes = await confirm({
      title: `Delete ${destination.name}?`,
      body: 'It has no records left. This cannot be undone.',
      action: 'Delete destination',
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      await catalog.deleteDestination(id);
      navigate('/admin/catalog', { replace: true });
    });
  }

  const sections: PageSection[] = [
    { id: 'records', label: 'Records', icon: ListBullets, count },
    { id: 'refresh', label: 'Website check', icon: ArrowsClockwise },
    { id: 'area', label: 'Area', icon: MapPin },
  ];

  const renderSection = (section: string) => {
    if (section === 'refresh') return <RefreshPanel destinationId={id} />;
    if (section === 'area') {
      return (
        <Section
          title="Area"
          description="Properties within this distance of the centre get this catalog. Event times are entered in its time zone."
          onSave={saveArea}
        >
          <AreaFields draft={draft} onChange={setDraft} />
        </Section>
      );
    }
    return <RecordsPanel destinationId={id} records={records} />;
  };

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <p className="muted">
            Within {destination.radiusKm} km · {recordCount(count)}
          </p>
        </div>
        <div className="actions">
          <Link className="button" to={`/admin/catalog/destinations/${id}/seeding`}>
            <MagnifyingGlass aria-hidden="true" />
            Find places
          </Link>
          <MoreActions
            label={`More actions for ${destination.name}`}
            items={[
              {
                label: 'Delete destination',
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

      <SectionLayout sections={sections} label="Destination sections" render={renderSection} />
    </>
  );
}

function recordLine(r: CatalogRecordSummary): string {
  const kind = r.placeCategory
    ? PLACE_CATEGORY_LABELS[r.placeCategory]
    : CATALOG_KIND_LABELS[r.kind];
  if (r.kind !== 'event' || !r.startsAt || !r.endsAt) return kind;
  return `${kind} · ${eventTime(r.startsAt)} to ${eventTime(r.endsAt)}`;
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
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('all');
  const shown = records?.filter((r) => tab === 'all' || r.kind === tab) ?? null;
  const add = (kind: CatalogKind) =>
    navigate(`/admin/catalog/destinations/${destinationId}/new/${kind}`);
  const addable: readonly CatalogKind[] = tab === 'all' ? CATALOG_KINDS : [tab];

  return (
    <section className="panel" aria-labelledby="records-heading">
      <div className="panel-head">
        <h2 id="records-heading">Records</h2>
        {addable.length === 1 && addable[0] ? (
          <button type="button" className="primary" onClick={() => add(addable[0] as CatalogKind)}>
            <Plus aria-hidden="true" weight="bold" />
            Add {CATALOG_KIND_LABELS[addable[0]].toLowerCase()}
          </button>
        ) : (
          <Menu
            label="Add a record"
            className="primary"
            trigger={
              <>
                <Plus aria-hidden="true" weight="bold" />
                Add record
                <CaretDown aria-hidden="true" />
              </>
            }
            items={addable.map((k) => ({
              label: CATALOG_KIND_LABELS[k],
              onSelect: () => add(k),
            }))}
          />
        )}
      </div>
      <Tabs label="Kind" items={TABS} value={tab} onChange={setTab} />
      {shown === null ? <p className="muted">Loading…</p> : null}
      {shown?.length === 0 ? (
        <EmptyState
          icon={ListBullets}
          title={
            tab === 'all'
              ? 'No records yet'
              : `No ${TABS.find((t) => t.id === tab)?.label.toLowerCase()} yet`
          }
        >
          {tab === 'all' || tab === 'place'
            ? 'Add one here, or use Find places to pick from what is nearby.'
            : 'Add one here.'}
        </EmptyState>
      ) : null}
      {shown && shown.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="wide-only">
                  Kind
                </th>
                <th scope="col">Status</th>
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
                      <span className="muted">Up to date</span>
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
    .map(
      ([status, n]) =>
        `${n} ${DRAFTING_TASK_STATUS_LABELS[status as keyof typeof run.counts].toLowerCase()}`,
    );
  return `Last check ${dateTime(run.startedAt)}: ${counts.length > 0 ? counts.join(', ') : 'nothing to do'}.`;
}

/** The pre-season website check (42): re-drafts verified places and queues only what changed. */
function RefreshPanel({ destinationId }: { destinationId: string }) {
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
            ? { text: 'No verified place is due for a check.', started: false }
            : {
                text: `Checking ${started.queued} ${started.queued === 1 ? 'place' : 'places'}${
                  started.waiting > 0 ? `; ${started.waiting} wait for the next run` : ''
                }. Any changes come to you in Curation.`,
                started: true,
              },
        );
      } finally {
        await load();
      }
    });

  return (
    <section className="panel refresh-panel" aria-labelledby="refresh-heading">
      <h2 id="refresh-heading">Website check</h2>
      {status?.refresh ? <p>{refreshLine(status.refresh)}</p> : null}
      <div className="seeding-import">
        <button
          type="button"
          className="primary"
          disabled={busy || status === null || queued > 0 || status.refreshDue === 0}
          onClick={start}
        >
          Check websites
        </button>
        {status ? (
          <span className="muted">
            {queued > 0
              ? `A check is running (${queued} in progress).`
              : status.refreshDue === 0
                ? 'No verified place is due.'
                : `${status.refreshDue} ${status.refreshDue === 1 ? 'place is' : 'places are'} due.`}
          </span>
        ) : null}
      </div>
      {notice && !error ? (
        <output className="saved" aria-live="polite">
          {notice.text}{' '}
          {notice.started ? (
            <Link to="/admin/curation?kind=refresh_diff">Open website changes</Link>
          ) : null}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
