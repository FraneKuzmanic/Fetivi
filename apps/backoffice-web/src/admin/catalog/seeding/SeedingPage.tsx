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
import { Trans, useTranslation } from 'react-i18next';
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
import { i18next, localeOf } from '../../../i18n';
import { currentLabels, useLabels } from '../../../i18n/useLabels';
import { EmptyState } from '../../../shell/EmptyState';
import { Pager } from '../../../shell/Pager';
import { usePageTitle } from '../../../shell/PageTitle';
import { SearchBox } from '../../../shell/SearchBox';
import { Tabs } from '../../../shell/Tabs';
import { useAction } from '../../../useAction';

/** The candidate lists, plus the new ones that look like another place, to settle first. */
type View = SeedingCandidateStatus | 'duplicates';

const t = i18next.getFixedT(null, 'admin', 'seeding');

const empty = (view: View): [string, string] =>
  ({
    new: [t('emptyNew'), t('emptyNewBody')] as [string, string],
    duplicates: [t('emptyDuplicates'), t('emptyDuplicatesBody')] as [string, string],
    ticked: [t('emptyTicked'), t('emptyTickedBody')] as [string, string],
    dismissed: [t('emptyDismissed'), t('emptyDismissedBody')] as [string, string],
  })[view];

const draftLabel = (status: CurationStatus): { label: string; tone: string } =>
  ({
    open: { label: t('draftOpen'), tone: 'wait' },
    needs_visit: { label: t('draftNeedsVisit'), tone: 'neutral' },
    approved: { label: t('draftApproved'), tone: 'ok' },
    rejected: { label: t('draftRejected'), tone: 'fail' },
  })[status];

const POLL_MS = 3000;
const PAGE = 50;
const SEND_MAX = SEEDING_LIMITS.draftPerRequest;

/** Lower case without accents, so "saldun" finds "Šaldun". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const km = (metres: number) =>
  (metres / 1000).toLocaleString(localeOf(i18next.language), { maximumFractionDigits: 1 });

const places = (n: number) => t('places', { count: n });

/** One line per source of the last search, for the "Where places come from" details. */
function sourceLines(run: SeedingImport): string[] {
  const labels = currentLabels();
  return SEEDING_SOURCES.flatMap((source) => {
    const result = run.sources[source];
    if (!result) return [];
    const label = labels.seedingSource[source];
    return result.outcome === 'ok'
      ? [t('sourceLine', { source: label, result: places(result.kept) })]
      : [t('sourceLine', { source: label, result: labels.seedingFailure[result.failure] })];
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
        counts.drafted > 0 ? t('drafted', { count: counts.drafted }) : null,
        counts.queued > 0 ? t('inProgress', { count: counts.queued }) : null,
        counts.no_sources > 0 ? t('noSources', { count: counts.no_sources }) : null,
        counts.failed > 0 ? t('failed', { count: counts.failed }) : null,
      ].filter(Boolean)
    : [];
  const waiting = status.waiting === 0 ? '' : ` ${t('waiting', { count: status.waiting })}`;
  if (parts.length === 0 && !waiting) return null;
  return `${parts.length > 0 ? t('drafting', { parts: parts.join(', ') }) : t('draftingNotStarted')}${waiting}`;
}

/** What sending did: how many draft now and how many wait over the per-run limit. */
function sentLine(drafted: number, run: { queued: number; waiting: number }): string {
  const sent = t('sent', { places: places(drafted) });
  if (run.waiting === 0) return `${sent} ${t('sentReady')}`;
  return `${sent} ${t('sentWaiting', {
    queued: run.queued,
    waiting: run.waiting,
    limit: DRAFTING_LIMITS.recordsPerRun,
  })}`;
}

function runLine(run: SeedingImport): string {
  if (run.status === 'running') return t('searchingSince', { when: formatMoment(run.startedAt) });
  const when = formatMoment(run.finishedAt ?? run.startedAt);
  return run.status === 'failed' ? t('unfinished', { when }) : t('lastSearch', { when });
}

/** /admin/catalog/destinations/:id/seeding: places found nearby, to pick from and draft. */
export function SeedingPage() {
  const labels = useLabels();
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

  usePageTitle(t('title'));

  if (!overview) {
    return error ? (
      <p role="alert">{error}</p>
    ) : (
      <p className="muted">{i18next.t('common:loading')}</p>
    );
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
    labels.placeCategory[a].localeCompare(labels.placeCategory[b]),
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
      return t('searchingNow');
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
        ? t('draftingNowWaiting', { queued: started.queued, waiting: started.waiting })
        : t('draftingNow', { queued: started.queued });
    });

  const [emptyTitle, emptyText] = empty(view);
  const filtering = query.trim() !== '' || category !== '';

  return (
    <>
      <nav className="crumbs" aria-label={i18next.t('common:page.breadcrumb')}>
        <Link to="/admin/catalog">{i18next.t('admin:catalog.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/admin/catalog/destinations/${id}`}>{destination.name}</Link>
      </nav>
      <div className="page-head">
        <button type="button" className="primary" disabled={busy || running} onClick={startImport}>
          <MagnifyingGlass aria-hidden="true" weight="bold" />
          {lastImport ? t('searchAgain') : t('title')}
        </button>
      </div>
      <p className="muted">{t('intro', { km: km(destination.radiusM), name: destination.name })}</p>

      <section className="seeding-status" aria-label={t('statusLabel')}>
        {lastImport ? (
          <p>
            {runLine(lastImport)}
            {lastImport.status === 'done' && incomplete(lastImport)
              ? ` ${t('missingSources')}`
              : ''}
          </p>
        ) : (
          <p>{t('notSearched')}</p>
        )}
        {line ? (
          <div className="seeding-import">
            <span>{line}</span>
            {status && status.waiting > 0 ? (
              <button type="button" disabled={busy} onClick={draftWaiting}>
                {status.waiting > DRAFTING_LIMITS.recordsPerRun
                  ? t('draftSome', {
                      limit: DRAFTING_LIMITS.recordsPerRun,
                      waiting: status.waiting,
                    })
                  : t('draftAll', { waiting: status.waiting })}
              </button>
            ) : null}
          </div>
        ) : null}
        {lastImport && lastImport.status !== 'running' ? (
          <details className="help">
            <summary>{t('whereFrom')}</summary>
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
        label={t('placesTabs')}
        items={[
          { id: 'new', label: t('toReview'), count: counts.new },
          ...(duplicates.length > 0 || view === 'duplicates'
            ? [
                {
                  id: 'duplicates' as const,
                  label: t('duplicates'),
                  count: duplicates.length,
                },
              ]
            : []),
          { id: 'ticked', label: t('sentTab'), count: counts.ticked },
          { id: 'dismissed', label: t('dismissed'), count: counts.dismissed },
        ]}
        value={view}
        onChange={setView}
      />

      {candidates.length > 0 ? (
        <div className="toolbar">
          <SearchBox
            label={t('searchName')}
            value={query}
            placeholder={t('searchName')}
            onChange={setQuery}
          />
          <label className="field inline-field">
            <span className="field-label visually-hidden">{t('category')}</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PlaceCategory | '')}
            >
              <option value="">{t('allCategories')}</option>
              {listedCategories.map((code) => (
                <option key={code} value={code}>
                  {labels.placeCategory[code]}
                </option>
              ))}
            </select>
          </label>
          <span className="toolbar-note">
            {overview.matchedRecords > 0 ? t('leftOut', { count: overview.matchedRecords }) : null}
          </span>
        </div>
      ) : null}

      {view !== 'duplicates' && counts[tab] > candidates.length ? (
        <p className="muted">
          {t('showingFirst', { shown: candidates.length, total: counts[tab] })}
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
            title={t('noMatch')}
            action={
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('');
                }}
              >
                {t('clearFilters')}
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
                  {t('title')}
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
                      aria-label={t('selectPage')}
                      checked={pageTicked}
                      disabled={busy || pageIds.length === 0}
                      onChange={togglePage}
                    />
                  </th>
                ) : null}
                <th scope="col">{t('place')}</th>
                <th scope="col" className="num wide-only">
                  {t('distance')}
                </th>
                <th scope="col">
                  <span className="visually-hidden">{i18next.t('common:table.actions')}</span>
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
        <section className="selection-bar" aria-label={t('selected')}>
          <span>
            <Trans
              t={t}
              i18nKey="selectedCount"
              values={{ count: selected.length }}
              components={{ strong: <strong /> }}
            />
            {tooMany ? <span className="muted">{t('sendUpTo', { max: SEND_MAX })}</span> : null}
          </span>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => setTicked(new Set())}>
              {t('clear')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || tooMany}
              onClick={sendToDrafting}
            >
              {t('draftPlaces', { count: selected.length })}
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
  useTranslation('admin');
  if (c.sources.length < 2) return null;
  return (
    <details className="seeding-rows">
      <summary>{t('foundAs', { count: c.sources.length })}</summary>
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
                    return t('splitDone', { name: s.name });
                  })
                }
              >
                {t('split')}
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
  const labels = useLabels();
  return (
    <tr className={ticked ? 'ticked' : undefined}>
      {c.status === 'new' ? (
        <td className="check-col">
          <input
            type="checkbox"
            aria-label={t('select', { name: c.name })}
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
            {labels.placeCategory[c.placeCategory]}
            {c.draft ? (
              <Link
                className={`chip ${draftLabel(c.draft.status).tone}`}
                to="/admin/curation?kind=draft"
              >
                {draftLabel(c.draft.status).label}
              </Link>
            ) : null}
            <Sources candidate={c} busy={busy} act={act} />
            {c.status === 'new' && c.possibleDuplicates.length > 0 ? (
              <button type="button" className="chip wait chip-button" onClick={onDuplicates}>
                {t('possibleDuplicate')}
              </button>
            ) : null}
          </span>
        </div>
      </td>
      <td className="num wide-only">{t('km', { km: km(c.distanceM) })}</td>
      <td className="cell-actions">
        {c.status === 'new' ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            aria-label={t('dismissAria', { name: c.name })}
            onClick={() =>
              act(async () => {
                await seeding.dismiss(c.id);
                return t('dismissedDone', { name: c.name });
              })
            }
          >
            {t('dismiss')}
          </button>
        ) : null}
        {c.status === 'dismissed' ? (
          <button
            type="button"
            disabled={busy}
            aria-label={t('restoreAria', { name: c.name })}
            onClick={() =>
              act(async () => {
                await seeding.restore(c.id);
                return t('restoredDone', { name: c.name });
              })
            }
          >
            {t('restore')}
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
  const labels = useLabels();
  return (
    <li className="block-row">
      <div className="block-text duplicate-text">
        <span className="block-title">
          <strong>{c.name}</strong>
          <span className="muted">
            {t('fromCentre', {
              category: labels.placeCategory[c.placeCategory],
              km: km(c.distanceM),
            })}
          </span>
        </span>
        <ul className="duplicate-pairs">
          {c.possibleDuplicates.map((d) => (
            <li key={d.id} className="duplicate-pair">
              <span>
                <Trans
                  t={t}
                  i18nKey="looksLike"
                  values={{ name: d.name, metres: d.distanceM }}
                  components={{ strong: <strong /> }}
                />
              </span>
              <span className="actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await seeding.merge(d.id, c.id);
                      return t('merged', { a: c.name, b: d.name });
                    })
                  }
                >
                  {t('merge')}
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await seeding.keepApart(c.id, d.id);
                      return t('keptApart', { a: c.name, b: d.name });
                    })
                  }
                >
                  {t('keepBoth')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
