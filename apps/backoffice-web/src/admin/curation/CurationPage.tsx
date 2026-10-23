import type { PlaceCategory, SourceField } from '@fetivi/domain/catalog-vocabulary';
import {
  CURATION_KINDS,
  type CurationAction,
  type CurationKind,
  type CurationTab,
} from '@fetivi/domain/curation-vocabulary';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, type CurationItem, catalog, curation, type Destination } from '../../api';
import {
  CURATION_ACTION_LABELS,
  CURATION_KIND_LABELS,
  CURATION_STATUS_LABELS,
  PLACE_CATEGORY_LABELS,
  SOURCE_FIELD_LABELS,
} from '../../forms/labels';
import { useAction } from '../../useAction';

const TABS: { tab: CurationTab; label: string; empty: string }[] = [
  { tab: 'open', label: 'Open', empty: 'Nothing to curate.' },
  { tab: 'needs_visit', label: 'Needs a visit', empty: 'No items need a visit.' },
  { tab: 'done', label: 'Done', empty: 'Nothing reviewed yet.' },
];

const KIND_TONE: Record<CurationKind, string> = {
  draft: 'neutral',
  refresh_diff: 'neutral',
  guest_flagged: 'fail',
  host_place_suggestion: 'wait',
  host_provider_suggestion: 'wait',
  fallback_topic_cluster: 'neutral',
};

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** A YYYY-MM-DD day as written, whatever the viewer's zone. */
const calendarDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });

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
      return item.record?.title ?? 'Record removed';
  }
}

/** What the kind proposes or reports, in a few words. */
function detail(item: CurationItem): string | null {
  const p = item.payload;
  switch (p.kind) {
    case 'draft':
    case 'refresh_diff': {
      const fields = Object.keys(p.changes).filter((f) => f !== 'fieldSources');
      if (fields.length === 0) return null;
      const names = fields.map((f) => SOURCE_FIELD_LABELS[f as SourceField] ?? f).join(', ');
      return p.kind === 'draft' ? `Proposes ${names}` : `Changed: ${names}`;
    }
    case 'guest_flagged':
      return `${p.count} ${p.count === 1 ? 'guest' : 'guests'} flagged it as ${p.reason}`;
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
  const { busy, error, run } = useAction();
  const [tab, setTab] = useState<CurationTab>('open');
  const [kind, setKind] = useState<CurationKind | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [items, setItems] = useState<CurationItem[] | null>(null);
  const [counts, setCounts] = useState<Record<CurationKind, number> | null>(null);

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
    void run(load);
  }, [run, load]);

  useEffect(() => {
    void run(async () => setDestinations((await catalog.destinations()).destinations));
  }, [run]);

  const act = (item: CurationItem, action: CurationAction) => {
    if (action === 'reject' && !window.confirm('Reject this item? The record stays as it is.')) {
      return;
    }
    void run(async () => {
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
        setCounts((await query()).counts);
      } catch (e) {
        // Another admin reviewed it first: show the list as it is now.
        if (e instanceof ApiError && e.status === 409) await load();
        throw e;
      }
    });
  };

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  const empty = TABS.find((t) => t.tab === tab)?.empty;

  return (
    <>
      <div className="page-head">
        <h1>Curation</h1>
        <Link className="button" to="/admin/curation/staleness">
          Staleness queue
        </Link>
      </div>
      <div className="filters">
        <div className="segmented" role="tablist" aria-label="Status">
          {TABS.map((t) => (
            <button
              key={t.tab}
              type="button"
              role="tab"
              aria-selected={tab === t.tab}
              onClick={() => setTab(t.tab)}
            >
              {t.label}
            </button>
          ))}
        </div>
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
      </div>
      <fieldset className="segmented wrap kind-filter" aria-label="Kind">
        <button type="button" aria-pressed={kind === null} onClick={() => setKind(null)}>
          All{total === null ? '' : ` ${total}`}
        </button>
        {CURATION_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {CURATION_KIND_LABELS[k]}
            {counts ? ` ${counts[k]}` : ''}
          </button>
        ))}
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      {items === null && !error ? <p className="muted">Loading…</p> : null}
      {items?.length === 0 ? <p className="muted">{empty}</p> : null}
      {items && items.length > 0 ? (
        <ul className="rows">
          {items.map((item) => {
            const more = detail(item);
            return (
              <li key={item.id} className="block-row">
                <div className="block-text">
                  <span className="block-title">
                    <span className={`chip ${KIND_TONE[item.kind]}`}>
                      {CURATION_KIND_LABELS[item.kind]}
                    </span>
                    <strong>{headline(item)}</strong>
                  </span>
                  {more ? <span className="muted">{more}</span> : null}
                  <span className="muted">{meta(item)}</span>
                </div>
                {item.actions.length > 0 ? (
                  <div className="actions">
                    {item.actions.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={a === 'approve' ? 'primary' : undefined}
                        disabled={busy}
                        onClick={() => act(item, a)}
                      >
                        {CURATION_ACTION_LABELS[a]}
                      </button>
                    ))}
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
