import type { PlaceCategory } from '@fetivi/domain/catalog-vocabulary';
import type { CurationStatus } from '@fetivi/domain/curation-vocabulary';
import { DRAFTING_LIMITS } from '@fetivi/domain/drafting-vocabulary';
import {
  SEEDING_LIMITS,
  SEEDING_SOURCES,
  type SeedingCandidateStatus,
  SOURCE_ATTRIBUTION,
} from '@fetivi/domain/seeding-vocabulary';
import { Copy, MagnifyingGlass, MapPin } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  type DraftingStatus,
  drafting,
  type SeedingCandidate,
  type SeedingImport,
  type SeedingOverview,
  seeding,
} from '../../../api';
import { formatMoment } from '../../../forms/datetime';
import {
  PLACE_CATEGORY_LABELS,
  SEEDING_FAILURE_LABELS,
  SEEDING_SOURCE_LABELS,
} from '../../../forms/labels';
import { EmptyState } from '../../../shell/EmptyState';
import { Pager } from '../../../shell/Pager';
import { usePageTitle } from '../../../shell/PageTitle';
import { SearchBox } from '../../../shell/SearchBox';
import { Tabs } from '../../../shell/Tabs';
import { useAction } from '../../../useAction';

/** The candidate lists, plus the new ones that look like another place, to settle first. */
type View = SeedingCandidateStatus | 'duplicates';

const EMPTY: Record<View, [string, string]> = {
  new: ['Nothing to review', 'Find places to fill this list with what is nearby.'],
  duplicates: ['No possible duplicates', 'Places that look like one another show up here.'],
  ticked: ['Nothing sent yet', 'Places you send to drafting are listed here.'],
  dismissed: [
    'Nothing dismissed',
    'Places you dismiss are kept here, in case you change your mind.',
  ],
};

const DRAFT_LABELS: Record<CurationStatus, { label: string; tone: string }> = {
  open: { label: 'Draft to review', tone: 'wait' },
  needs_visit: { label: 'Needs a visit', tone: 'neutral' },
  approved: { label: 'In the catalog', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'fail' },
};

const POLL_MS = 3000;
const PAGE = 50;
const SEND_MAX = SEEDING_LIMITS.draftPerRequest;

/** Lower case without accents, so "saldun" finds "Šaldun". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const km = (metres: number) =>
  (metres / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 });

const places = (n: number) => (n === 1 ? '1 place' : `${n.toLocaleString('en-GB')} places`);

/** One line per source of the last search, for the "Where places come from" details. */
function sourceLines(run: SeedingImport): string[] {
  return SEEDING_SOURCES.flatMap((source) => {
    const result = run.sources[source];
    if (!result) return [];
    const label = SEEDING_SOURCE_LABELS[source];
    return result.outcome === 'ok'
      ? [`${label}: ${places(result.kept)}`]
      : [`${label}: ${SEEDING_FAILURE_LABELS[result.failure]}`];
  });
}

/** Whether a source did not answer, so the last search may have missed places. */
const incomplete = (run: SeedingImport) =>
  SEEDING_SOURCES.some((s) => run.sources[s]?.outcome === 'failed');

/** How drafting is going, e.g. "18 drafted, 4 in progress. 5 wait for the next run." */
function draftingLine(status: DraftingStatus): string | null {
  const counts = status.draft?.counts;
  const parts = counts
    ? [
        counts.drafted > 0 ? `${counts.drafted} drafted` : null,
        counts.queued > 0 ? `${counts.queued} in progress` : null,
        counts.no_sources > 0
          ? `${counts.no_sources} couldn’t be drafted (no readable web page)`
          : null,
        counts.failed > 0 ? `${counts.failed} didn’t work` : null,
      ].filter(Boolean)
    : [];
  const waiting =
    status.waiting === 0
      ? ''
      : status.waiting === 1
        ? ' 1 waits for the next run.'
        : ` ${status.waiting} wait for the next run.`;
  if (parts.length === 0 && !waiting) return null;
  return `Drafting: ${parts.length > 0 ? `${parts.join(', ')}.` : 'not started yet.'}${waiting}`;
}

/** What sending did: how many draft now and how many wait over the per-run limit. */
function sentLine(drafted: number, run: { queued: number; waiting: number }): string {
  const sent = `Sent ${places(drafted)} to drafting.`;
  if (run.waiting === 0) return `${sent} The drafts show up in Curation when they are ready.`;
  return `${sent} ${run.queued} are being drafted now; ${run.waiting} wait for the next run (up to ${DRAFTING_LIMITS.recordsPerRun} at a time).`;
}

function runLine(run: SeedingImport): string {
  if (run.status === 'running') return `Searching since ${formatMoment(run.startedAt)}…`;
  const when = formatMoment(run.finishedAt ?? run.startedAt);
  return run.status === 'failed'
    ? `The last search didn’t finish (${when}).`
    : `Last search ${when}.`;
}

/** /admin/catalog/destinations/:id/seeding: places found nearby, to pick from and draft. */
export function SeedingPage() {
  const { id = '' } = useParams();
  const { busy, error, run } = useAction();
  const [view, setView] = useState<View>('new');
  const tab: SeedingCandidateStatus = view === 'duplicates' ? 'new' : view;
  const [overview, setOverview] = useState<SeedingOverview | null>(null);
  const [status, setStatus] = useState<DraftingStatus | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<PlaceCategory | ''>('');
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    const [fresh, draftingStatus] = await Promise.all([
      seeding.overview(id, tab),
      drafting.status(id),
    ]);
    setOverview(fresh);
    setStatus(draftingStatus);
  }, [id, tab]);

  useEffect(() => {
    setOverview(null);
    setTicked(new Set());
    setNotice(null);
    void run(load);
  }, [run, load]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts at page one.
  useEffect(() => setOffset(0), [view, query, category]);

  const running = overview?.lastImport?.status === 'running';
  const draftingNow = (status?.draft?.counts.queued ?? 0) > 0;

  // While a search or a drafting run is going, refresh until it is done. A failed poll is
  // retried on the next tick.
  useEffect(() => {
    if (!running && !draftingNow) return;
    const timer = setInterval(() => void load().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [running, draftingNow, load]);

  /** Runs one action, reloads, and says what happened; a 409 reloads first, then shows why. */
  const act = (action: () => Promise<string>) =>
    void run(async () => {
      setNotice(null);
      try {
        const done = await action();
        await load();
        setNotice(done);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) await load();
        throw e;
      }
    });

  usePageTitle('Find places');

  if (!overview) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const { destination, lastImport, counts, candidates } = overview;
  const duplicates =
    view === 'new' || view === 'duplicates'
      ? candidates.filter((c) => c.possibleDuplicates.length > 0)
      : [];
  const listed = view === 'duplicates' ? duplicates : candidates;
  const shown = listed.filter(
    (c) =>
      (category === '' || c.placeCategory === category) &&
      fold(c.name).includes(fold(query.trim())),
  );
  const page = shown.slice(offset, offset + PAGE);
  const selected = candidates.filter((c) => ticked.has(c.id)).map((c) => c.id);
  const listedCategories = [...new Set(candidates.map((c) => c.placeCategory))].sort((a, b) =>
    PLACE_CATEGORY_LABELS[a].localeCompare(PLACE_CATEGORY_LABELS[b]),
  );
  const tooMany = selected.length > SEND_MAX;
  const line = status ? draftingLine(status) : null;
  const pageIds = page.filter((c) => c.status === 'new').map((c) => c.id);
  const pageTicked = pageIds.length > 0 && pageIds.every((cid) => ticked.has(cid));

  const toggle = (candidateId: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });

  const togglePage = () =>
    setTicked((current) => {
      const next = new Set(current);
      for (const cid of pageIds) {
        if (pageTicked) next.delete(cid);
        else next.add(cid);
      }
      return next;
    });

  const startImport = () =>
    act(async () => {
      await seeding.startImport(id);
      return 'Searching. The list refreshes when it is done.';
    });

  const sendToDrafting = () =>
    act(async () => {
      const sent = await seeding.draft(id, selected);
      setTicked(new Set());
      return sentLine(sent.drafted, sent.run);
    });

  const draftWaiting = () =>
    act(async () => {
      const started = await drafting.draftWaiting(id);
      return started.waiting > 0
        ? `${started.queued} are being drafted now; ${started.waiting} still wait.`
        : `${started.queued} are being drafted now.`;
    });

  const [emptyTitle, emptyText] = EMPTY[view];
  const filtering = query.trim() !== '' || category !== '';

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/admin/catalog/destinations/${id}`}>{destination.name}</Link>
      </nav>
      <div className="page-head">
        <button type="button" className="primary" disabled={busy || running} onClick={startImport}>
          <MagnifyingGlass aria-hidden="true" weight="bold" />
          {lastImport ? 'Search again' : 'Find places'}
        </button>
      </div>
      <p className="muted">
        Places within {km(destination.radiusM)} km of {destination.name}. Pick the ones worth adding
        and send them to drafting. Nothing reaches guests until you approve it in Curation.
      </p>

      <section className="seeding-status" aria-label="Search and drafting">
        {lastImport ? (
          <p>
            {runLine(lastImport)}
            {lastImport.status === 'done' && incomplete(lastImport)
              ? ' Some sources didn’t answer, so places may be missing; search again later.'
              : ''}
          </p>
        ) : (
          <p>Not searched yet.</p>
        )}
        {line ? (
          <div className="seeding-import">
            <span>{line}</span>
            {status && status.waiting > 0 ? (
              <button type="button" disabled={busy} onClick={draftWaiting}>
                {status.waiting > DRAFTING_LIMITS.recordsPerRun
                  ? `Draft ${DRAFTING_LIMITS.recordsPerRun} of ${status.waiting} now`
                  : `Draft ${status.waiting} now`}
              </button>
            ) : null}
          </div>
        ) : null}
        {lastImport && lastImport.status !== 'running' ? (
          <details className="help">
            <summary>Where places come from</summary>
            <ul className="seeding-sources">
              {sourceLines(lastImport).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="muted">{SEEDING_SOURCES.map((s) => SOURCE_ATTRIBUTION[s]).join(' · ')}</p>
          </details>
        ) : null}
      </section>

      <Tabs
        label="Places"
        items={[
          { id: 'new', label: 'To review', count: counts.new },
          ...(duplicates.length > 0 || view === 'duplicates'
            ? [
                {
                  id: 'duplicates' as const,
                  label: 'Possible duplicates',
                  count: duplicates.length,
                },
              ]
            : []),
          { id: 'ticked', label: 'Sent to drafting', count: counts.ticked },
          { id: 'dismissed', label: 'Dismissed', count: counts.dismissed },
        ]}
        value={view}
        onChange={setView}
      />

      {candidates.length > 0 ? (
        <div className="toolbar">
          <SearchBox
            label="Search by name"
            value={query}
            placeholder="Search by name"
            onChange={setQuery}
          />
          <label className="field inline-field">
            <span className="field-label visually-hidden">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PlaceCategory | '')}
            >
              <option value="">All categories</option>
              {listedCategories.map((code) => (
                <option key={code} value={code}>
                  {PLACE_CATEGORY_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <span className="toolbar-note">
            {overview.matchedRecords > 0
              ? `${places(overview.matchedRecords)} already in the catalog are left out`
              : null}
          </span>
        </div>
      ) : null}

      {view !== 'duplicates' && counts[tab] > candidates.length ? (
        <p className="muted">
          Showing the first {candidates.length} of {counts[tab]}, by name. Send or dismiss some to
          see the rest.
        </p>
      ) : null}

      {notice && !error ? (
        <output className="saved" aria-live="polite">
          {notice}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      {shown.length === 0 ? (
        filtering && listed.length > 0 ? (
          <EmptyState
            icon={MagnifyingGlass}
            title="No place matches"
            action={
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('');
                }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={view === 'duplicates' ? Copy : MapPin}
            title={emptyTitle}
            action={
              view === 'new' && !lastImport ? (
                <button type="button" className="primary" disabled={busy} onClick={startImport}>
                  Find places
                </button>
              ) : undefined
            }
          >
            {emptyText}
          </EmptyState>
        )
      ) : view === 'duplicates' ? (
        <ul className="rows">
          {page.map((c) => (
            <DuplicateRow key={c.id} candidate={c} busy={busy} act={act} />
          ))}
        </ul>
      ) : (
        <div className="table-frame">
          <table className="data-table seeding-table">
            <thead>
              <tr>
                {view === 'new' ? (
                  <th scope="col" className="check-col">
                    <input
                      type="checkbox"
                      aria-label="Select every place on this page"
                      checked={pageTicked}
                      disabled={busy || pageIds.length === 0}
                      onChange={togglePage}
                    />
                  </th>
                ) : null}
                <th scope="col">Place</th>
                <th scope="col" className="num wide-only">
                  Distance
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {page.map((c) => (
                <CandidateRow
                  key={c.id}
                  candidate={c}
                  busy={busy}
                  ticked={ticked.has(c.id)}
                  onToggle={() => toggle(c.id)}
                  onDuplicates={() => setView('duplicates')}
                  act={act}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > PAGE ? (
        <Pager offset={offset} total={shown.length} size={PAGE} onChange={setOffset} />
      ) : null}

      {view === 'new' && selected.length > 0 ? (
        <section className="selection-bar" aria-label="Selected places">
          <span>
            <strong>{selected.length}</strong> selected
            {tooMany ? <span className="muted"> · send up to {SEND_MAX} at a time</span> : null}
          </span>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => setTicked(new Set())}>
              Clear
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || tooMany}
              onClick={sendToDrafting}
            >
              Draft {places(selected.length)}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

/** A place found as several entries, opened to split one off when they are not the same. */
function Sources({
  candidate: c,
  busy,
  act,
}: {
  candidate: SeedingCandidate;
  busy: boolean;
  act: (action: () => Promise<string>) => void;
}) {
  if (c.sources.length < 2) return null;
  return (
    <details className="seeding-rows">
      <summary>Found as {c.sources.length} entries</summary>
      <ul>
        {c.sources.map((s) => (
          <li key={s.id}>
            {s.sourceUrl ? (
              <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                {s.name}
              </a>
            ) : (
              <span>{s.name}</span>
            )}
            {c.status === 'new' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await seeding.split(s.id);
                    return `${s.name} is now a place of its own.`;
                  })
                }
              >
                Split off
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CandidateRow({
  candidate: c,
  busy,
  ticked,
  onToggle,
  onDuplicates,
  act,
}: {
  candidate: SeedingCandidate;
  busy: boolean;
  ticked: boolean;
  onToggle: () => void;
  onDuplicates: () => void;
  act: (action: () => Promise<string>) => void;
}) {
  return (
    <tr className={ticked ? 'ticked' : undefined}>
      {c.status === 'new' ? (
        <td className="check-col">
          <input
            type="checkbox"
            aria-label={`Select ${c.name}`}
            checked={ticked}
            disabled={busy}
            onChange={onToggle}
          />
        </td>
      ) : null}
      <td>
        <div className="cell-main">
          <strong>{c.name}</strong>
          <span className="cell-sub with-chips">
            {PLACE_CATEGORY_LABELS[c.placeCategory]}
            {c.draft ? (
              <Link
                className={`chip ${DRAFT_LABELS[c.draft.status].tone}`}
                to="/admin/curation?kind=draft"
              >
                {DRAFT_LABELS[c.draft.status].label}
              </Link>
            ) : null}
            <Sources candidate={c} busy={busy} act={act} />
            {c.status === 'new' && c.possibleDuplicates.length > 0 ? (
              <button type="button" className="chip wait chip-button" onClick={onDuplicates}>
                Possible duplicate
              </button>
            ) : null}
          </span>
        </div>
      </td>
      <td className="num wide-only">{km(c.distanceM)} km</td>
      <td className="cell-actions">
        {c.status === 'new' ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            aria-label={`Dismiss ${c.name}`}
            onClick={() =>
              act(async () => {
                await seeding.dismiss(c.id);
                return `${c.name} dismissed.`;
              })
            }
          >
            Dismiss
          </button>
        ) : null}
        {c.status === 'dismissed' ? (
          <button
            type="button"
            disabled={busy}
            aria-label={`Restore ${c.name}`}
            onClick={() =>
              act(async () => {
                await seeding.restore(c.id);
                return `${c.name} is back in To review.`;
              })
            }
          >
            Restore
          </button>
        ) : null}
      </td>
    </tr>
  );
}

/** A new place that looks like others nearby: merge each pair or keep both. */
function DuplicateRow({
  candidate: c,
  busy,
  act,
}: {
  candidate: SeedingCandidate;
  busy: boolean;
  act: (action: () => Promise<string>) => void;
}) {
  return (
    <li className="block-row">
      <div className="block-text duplicate-text">
        <span className="block-title">
          <strong>{c.name}</strong>
          <span className="muted">
            {PLACE_CATEGORY_LABELS[c.placeCategory]} · {km(c.distanceM)} km from the centre
          </span>
        </span>
        <ul className="duplicate-pairs">
          {c.possibleDuplicates.map((d) => (
            <li key={d.id} className="duplicate-pair">
              <span>
                Looks like <strong>{d.name}</strong>, {d.distanceM} m away
              </span>
              <span className="actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await seeding.merge(d.id, c.id);
                      return `${c.name} and ${d.name} are now one place.`;
                    })
                  }
                >
                  Merge
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await seeding.keepApart(c.id, d.id);
                      return `${c.name} and ${d.name} stay separate.`;
                    })
                  }
                >
                  Keep both
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
