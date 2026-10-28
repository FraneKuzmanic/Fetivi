import type { PlaceCategory, SourceField } from '@fetivi/domain/catalog-vocabulary';
import {
  CURATED_TEXT_FIELDS,
  CURATION_KINDS,
  type CuratedChanges,
  type CurationAction,
  type CurationKind,
  type CurationTab,
  type DraftedHours,
  type DraftedSeason,
} from '@fetivi/domain/curation-vocabulary';
import { SOURCE_LABELS } from '@fetivi/domain/seeding-vocabulary';
import { ClockCounterClockwise, DotsThree, ListChecks } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, type CurationItem, catalog, curation, type Destination } from '../../api';
import { formatDate, formatDay } from '../../forms/datetime';
import {
  CURATION_ACTION_LABELS,
  CURATION_KIND_LABELS,
  CURATION_STATUS_LABELS,
  PLACE_CATEGORY_LABELS,
  SOURCE_FIELD_LABELS,
  WEEKDAY_LABELS,
} from '../../forms/labels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { EmptyState } from '../../shell/EmptyState';
import { Menu } from '../../shell/Menu';
import { usePageTitle } from '../../shell/PageTitle';
import { Tabs } from '../../shell/Tabs';
import { useAction } from '../../useAction';

const TABS: { id: CurationTab; label: string; empty: [string, string] }[] = [
  {
    id: 'open',
    label: 'To review',
    empty: [
      'All caught up',
      'Drafts, website changes, guest flags and host suggestions wait here for your review.',
    ],
  },
  {
    id: 'needs_visit',
    label: 'Needs a visit',
    empty: ['Nothing needs a visit', 'Items you can only check in person wait here.'],
  },
  { id: 'done', label: 'Done', empty: ['Nothing reviewed yet', 'Items you review end up here.'] },
];

const KIND_TONE: Record<CurationKind, string> = {
  draft: 'neutral',
  refresh_diff: 'neutral',
  guest_flagged: 'fail',
  host_place_suggestion: 'wait',
  host_provider_suggestion: 'wait',
  fallback_topic_cluster: 'neutral',
};

const date = formatDay;

/** A YYYY-MM-DD day as written, whatever the viewer's zone. */
const calendarDay = formatDate;

const categoryLabel = (code: string) => PLACE_CATEGORY_LABELS[code as PlaceCategory] ?? code;

/** The row's one-line headline, per kind. */
function headline(item: CurationItem): string {
  const p = item.payload;
  switch (p.kind) {
    case 'host_place_suggestion':
      return `${p.name} · ${categoryLabel(p.placeCategory)}`;
    case 'host_provider_suggestion':
      return p.name;
    case 'fallback_topic_cluster':
      return `“${p.topic}”: ${p.count} ${p.count === 1 ? 'search' : 'searches'}, ${p.noResults} without results, week of ${calendarDay(p.weekStart)}`;
    default:
      return item.record?.title ?? item.candidate?.name ?? 'Record removed';
  }
}

/** What the kind proposes or reports, in a few words. */
function detail(item: CurationItem): string | null {
  const p = item.payload;
  switch (p.kind) {
    case 'draft':
    case 'refresh_diff': {
      if (p.kind === 'draft' && !item.record && item.candidate && !item.drafted) {
        if (p.drafting?.status === 'no_sources') {
          return 'Couldn’t be drafted: no readable web page about it';
        }
        if (p.drafting?.status === 'failed') return 'Drafting didn’t work';
        return p.drafting ? 'Being drafted' : 'Waiting to be drafted';
      }
      const fields = proposedFields(p.changes);
      if (fields.length === 0) return null;
      const names = fields.map((f) => SOURCE_FIELD_LABELS[f as SourceField] ?? f).join(', ');
      return p.kind === 'draft' ? `Proposes ${names}` : `Changed: ${names}`;
    }
    case 'guest_flagged':
      return `Flagged as ${p.reason} in ${p.count} ${p.count === 1 ? 'answer' : 'answers'}`;
    case 'fallback_topic_cluster':
      return [
        p.topics.length > 1 ? `Asked as ${p.topics.join(', ')}` : null,
        p.places.length > 0 ? `Near ${p.places.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    case 'host_place_suggestion':
      return [p.address, p.note].filter(Boolean).join(' · ') || null;
    case 'host_provider_suggestion':
      return [p.contact, p.note].filter(Boolean).join(' · ') || null;
  }
}

/** The record's field order; jsonb does not keep the order the job wrote. */
const FIELD_ORDER: readonly string[] = [...CURATED_TEXT_FIELDS, 'openingHours', 'seasons'];

/** The fields a draft or diff proposes, in the record's field order. */
const proposedFields = (changes: CuratedChanges) =>
  (Object.keys(changes).filter((f) => f !== 'fieldSources') as (keyof CuratedChanges)[]).sort(
    (a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b),
  );

const dayMonth = (month: number, day: number) =>
  new Date(Date.UTC(2000, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const hoursText = (hours: DraftedHours[]) =>
  hours
    .map((h) => {
      const dates =
        h.validFrom || h.validTo
          ? ` (${h.validFrom ? calendarDay(h.validFrom) : '…'} to ${h.validTo ? calendarDay(h.validTo) : '…'})`
          : '';
      return `${WEEKDAY_LABELS[h.weekday]?.slice(0, 3) ?? h.weekday} ${h.opens}–${h.closes}${dates}`;
    })
    .join(', ');

const seasonsText = (seasons: DraftedSeason[]) =>
  seasons
    .map((s) => `${dayMonth(s.fromMonth, s.fromDay)} – ${dayMonth(s.toMonth, s.toDay)}`)
    .join(', ');

/** A proposed or previous value as plain text; never rendered as HTML. */
function valueText(changes: CuratedChanges, field: keyof CuratedChanges): string | null {
  const value = changes[field];
  if (value === undefined) return null;
  if (field === 'openingHours') return hoursText(value as DraftedHours[]) || 'None';
  if (field === 'seasons') return seasonsText(value as DraftedSeason[]) || 'None';
  return typeof value === 'string' ? value : null;
}

/** Only web links become links: a source URL came from a page, so it is checked again here. */
const isWebUrl = (url: string | null | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url);

function SourceLink({ url }: { url: string | null | undefined }) {
  return isWebUrl(url) ? (
    <a className="proposal-source" href={url} target="_blank" rel="noreferrer noopener">
      source
    </a>
  ) : null;
}

/** "Show proposal": each field a draft or diff proposes, with its source and previous value. */
function Proposal({ item }: { item: CurationItem }) {
  const p = item.payload;
  if (p.kind !== 'draft' && p.kind !== 'refresh_diff') return null;
  if (p.kind === 'draft' && !item.record && !item.drafted) return null;
  const fields = proposedFields(p.changes);
  if (fields.length === 0) return null;
  const sources = p.changes.fieldSources ?? {};
  return (
    <details className="proposal">
      <summary>Show proposal</summary>
      <dl>
        {fields.map((field) => {
          const previous = p.kind === 'refresh_diff' ? valueText(p.previous, field) : null;
          return (
            <div key={field} className="proposal-field">
              <dt>{SOURCE_FIELD_LABELS[field as SourceField] ?? field}</dt>
              <dd>
                {p.kind === 'refresh_diff' ? (
                  previous === null ? (
                    <span className="muted">Was empty. </span>
                  ) : (
                    <>
                      <del>{previous}</del>{' '}
                    </>
                  )
                ) : null}
                <span>{valueText(p.changes, field)}</span> <SourceLink url={sources[field]} />
              </dd>
            </div>
          );
        })}
        {p.kind === 'draft' && p.place ? (
          <>
            <div className="proposal-field">
              <dt>{SOURCE_FIELD_LABELS.placeCategory}</dt>
              <dd>
                {categoryLabel(p.place.placeCategory)}{' '}
                <SourceLink url={p.place.categorySourceUrl} />
              </dd>
            </div>
            <div className="proposal-field">
              <dt>{SOURCE_FIELD_LABELS.location}</dt>
              <dd>
                From {SOURCE_LABELS[p.place.locationSource]}{' '}
                <SourceLink url={p.place.locationSourceUrl} />
              </dd>
            </div>
          </>
        ) : null}
        {p.kind === 'draft'
          ? (p.images ?? []).map((image) => (
              <div key={image.url} className="proposal-field">
                <dt>Image</dt>
                <dd>
                  Wikimedia Commons, {image.attribution} · {image.licence}{' '}
                  <SourceLink url={image.sourcePageUrl} />
                </dd>
              </div>
            ))
          : null}
      </dl>
    </details>
  );
}

/** A short name for the item, for the status line after an action. */
function subject(item: CurationItem): string {
  const p = item.payload;
  if (p.kind === 'fallback_topic_cluster') return `“${p.topic}”`;
  if ('name' in p) return p.name;
  return item.record?.title ?? item.candidate?.name ?? 'The item';
}

const DONE: Partial<Record<CurationAction, string>> = {
  approve: 'approved. It is under Done.',
  reject: 'rejected. It is under Done.',
  needs_visit: 'moved to Needs a visit.',
};

function meta(item: CurationItem): string {
  return [
    item.destination?.name ?? 'No destination',
    item.host?.email,
    item.reviewedAt ? `Reviewed ${date(item.reviewedAt)}` : `Added ${date(item.createdAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** /admin/curation: the one queue of everything waiting for the admin's review. */
export function CurationPage() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const { busy, error, run } = useAction();
  const [tab, setTab] = useState<CurationTab>('open');
  // ?kind=draft, as the Seeding screen links it.
  const [kind, setKind] = useState<CurationKind | null>(() => {
    const k = params.get('kind');
    return CURATION_KINDS.find((c) => c === k) ?? null;
  });
  const [destinationId, setDestinationId] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [items, setItems] = useState<CurationItem[] | null>(null);
  const [counts, setCounts] = useState<Record<CurationKind, number> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useCallback(
    () =>
      curation.list({
        status: tab,
        kind: kind ?? undefined,
        destinationId: destinationId || undefined,
      }),
    [tab, kind, destinationId],
  );

  const load = useCallback(async () => {
    const result = await query();
    setItems(result.items);
    setCounts(result.counts);
  }, [query]);

  useEffect(() => {
    setItems(null);
    setNotice(null);
    void run(load);
  }, [run, load]);

  useEffect(() => {
    void run(async () => setDestinations((await catalog.destinations()).destinations));
  }, [run]);

  const act = async (item: CurationItem, action: CurationAction) => {
    if (action === 'reject') {
      const yes = await confirm({
        title: `Reject ${subject(item)}?`,
        body: 'Nothing changes in the catalog. The item moves to Done.',
        action: 'Reject',
        danger: true,
      });
      if (!yes) return;
    }
    void run(async () => {
      setNotice(null);
      try {
        if (action === 'edit') {
          const { recordId } = await curation.edit(item.id);
          navigate(`/admin/catalog/records/${recordId}`);
          return;
        }
        if (action === 'approve') await curation.approve(item.id);
        if (action === 'reject') await curation.reject(item.id);
        if (action === 'needs_visit') await curation.needsVisit(item.id);
        setItems((rows) => rows?.filter((r) => r.id !== item.id) ?? null);
        setNotice(`${subject(item)} ${DONE[action]}`);
        setCounts((await query()).counts);
      } catch (e) {
        // Another admin reviewed it first: show the list as it is now.
        if (e instanceof ApiError && e.status === 409) await load();
        throw e;
      }
    });
  };

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  const [emptyTitle, emptyText] = TABS.find((t) => t.id === tab)?.empty ?? ['', ''];
  const filtered = kind !== null || destinationId !== '';

  usePageTitle('Curation');

  return (
    <>
      <Tabs label="Status" items={TABS} value={tab} onChange={setTab} />
      <div className="toolbar">
        <label className="field inline-field">
          <span className="field-label">Destination</span>
          <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
            <option value="">All destinations</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field inline-field">
          <span className="field-label">Kind</span>
          <select
            value={kind ?? ''}
            onChange={(e) => setKind((e.target.value || null) as CurationKind | null)}
          >
            <option value="">All kinds{total ? ` (${total})` : ''}</option>
            {CURATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {CURATION_KIND_LABELS[k]}
                {counts?.[k] ? ` (${counts[k]})` : ''}
              </option>
            ))}
          </select>
        </label>
        <Link className="button toolbar-end" to="/admin/curation/staleness">
          <ClockCounterClockwise aria-hidden="true" />
          Due for a re-check
        </Link>
      </div>
      {notice && !error ? (
        <output className="saved" aria-live="polite">
          {notice}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {items === null && !error ? <p className="muted">Loading…</p> : null}
      {items?.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={ListChecks}
            title="Nothing matches these filters"
            action={
              <button
                type="button"
                onClick={() => {
                  setKind(null);
                  setDestinationId('');
                }}
              >
                Show everything
              </button>
            }
          />
        ) : (
          <EmptyState icon={ListChecks} title={emptyTitle}>
            {emptyText}
          </EmptyState>
        )
      ) : null}
      {items && items.length > 0 ? (
        <ul className="rows">
          {items.map((item) => {
            const more = detail(item);
            const [first, ...rest] = item.actions;
            return (
              <li key={item.id} className="block-row curation-row">
                <div className="block-text">
                  <span className="block-title">
                    <span className={`chip ${KIND_TONE[item.kind]}`}>
                      {CURATION_KIND_LABELS[item.kind]}
                    </span>
                    <strong>{headline(item)}</strong>
                  </span>
                  {more ? <span className="muted">{more}</span> : null}
                  <span className="muted">{meta(item)}</span>
                  <Proposal item={item} />
                </div>
                {first ? (
                  <div className="actions queue-actions">
                    <button
                      type="button"
                      className={first === 'approve' ? 'primary' : undefined}
                      disabled={busy}
                      onClick={() => void act(item, first)}
                    >
                      {CURATION_ACTION_LABELS[first]}
                    </button>
                    {rest.length > 0 ? (
                      <Menu
                        label={`More for ${subject(item)}`}
                        trigger={<DotsThree aria-hidden="true" weight="bold" />}
                        items={rest.map((a) => ({
                          label: CURATION_ACTION_LABELS[a],
                          danger: a === 'reject',
                          onSelect: () => void act(item, a),
                        }))}
                      />
                    ) : null}
                  </div>
                ) : (
                  <span className={`chip ${item.status === 'approved' ? 'ok' : 'neutral'}`}>
                    {CURATION_STATUS_LABELS[item.status]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
