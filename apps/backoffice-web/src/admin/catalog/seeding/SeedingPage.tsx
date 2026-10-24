import type { CurationStatus } from '@fetivi/domain/curation-vocabulary';
import {
  SEEDING_SOURCES,
  type SeedingCandidateStatus,
  SOURCE_ATTRIBUTION,
} from '@fetivi/domain/seeding-vocabulary';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ApiError,
  type SeedingCandidate,
  type SeedingImport,
  type SeedingOverview,
  seeding,
} from '../../../api';
import {
  PLACE_CATEGORY_LABELS,
  SEEDING_FAILURE_LABELS,
  SEEDING_SOURCE_LABELS,
} from '../../../forms/labels';
import { useAction } from '../../../useAction';

const TABS: { tab: SeedingCandidateStatus; label: string; empty: string }[] = [
  { tab: 'new', label: 'New', empty: 'No new candidates. Import to find places.' },
  { tab: 'ticked', label: 'Ticked', empty: 'Nothing sent to drafting yet.' },
  { tab: 'dismissed', label: 'Dismissed', empty: 'Nothing dismissed.' },
];

const DRAFT_LABELS: Record<CurationStatus, { label: string; tone: string }> = {
  open: { label: 'Waiting for draft', tone: 'wait' },
  needs_visit: { label: 'Needs a visit', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Rejected', tone: 'fail' },
};

const POLL_MS = 3000;

const km = (metres: number) =>
  (metres / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** One line per source of the last run, e.g. "OpenStreetMap: 187 places (55 skipped)". */
function sourceLines(run: SeedingImport): string[] {
  return SEEDING_SOURCES.flatMap((source) => {
    const result = run.sources[source];
    if (!result) return [];
    const label = SEEDING_SOURCE_LABELS[source];
    return result.outcome === 'ok'
      ? [`${label}: ${result.kept} places (${result.skipped} skipped)`]
      : [`${label}: ${SEEDING_FAILURE_LABELS[result.failure]}`];
  });
}

function runLine(run: SeedingImport): string {
  if (run.status === 'running') return `Import running since ${dateTime(run.startedAt)}.`;
  const when = dateTime(run.finishedAt ?? run.startedAt);
  return run.status === 'failed' ? `Last import failed, ${when}.` : `Last import ${when}.`;
}

/** /admin/catalog/destinations/:id/seeding: open-data candidates, merge review, tick to draft. */
export function SeedingPage() {
  const { id = '' } = useParams();
  const { busy, error, run } = useAction();
  const [tab, setTab] = useState<SeedingCandidateStatus>('new');
  const [overview, setOverview] = useState<SeedingOverview | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setOverview(await seeding.overview(id, tab));
  }, [id, tab]);

  useEffect(() => {
    setOverview(null);
    setTicked(new Set());
    setNotice(null);
    void run(load);
  }, [run, load]);

  const running = overview?.lastImport?.status === 'running';

  // While an import runs, refresh until it is done. A failed poll is retried on the next tick.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load().catch(() => {}), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

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

  if (!overview) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const { destination, lastImport, counts, candidates } = overview;
  const selected = candidates.filter((c) => ticked.has(c.id)).map((c) => c.id);

  const toggle = (candidateId: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });

  const startImport = () =>
    act(async () => {
      await seeding.startImport(id);
      return 'Import started. The list refreshes when it is done.';
    });

  const sendToDrafting = () =>
    act(async () => {
      await seeding.draft(id, selected);
      setTicked(new Set());
      return selected.length === 1
        ? '1 sent to drafting. It waits in the curation queue as a draft.'
        : `${selected.length} sent to drafting. They wait in the curation queue as drafts.`;
    });

  const empty = TABS.find((t) => t.tab === tab)?.empty;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/catalog">Catalog</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/admin/catalog/destinations/${id}`}>{destination.name}</Link>
      </nav>
      <div className="page-head">
        <h1>
          Seeding <span className="muted">· {destination.name}</span>
        </h1>
      </div>

      <section className="panel" aria-label="Import">
        <p>
          Finds places within {km(destination.radiusM)} km in OpenStreetMap, the EEA bathing-water
          list and Overture Maps. Imported names and coordinates stay in the open-data table.
        </p>
        <div className="seeding-import">
          <button
            type="button"
            className="primary"
            disabled={busy || running}
            onClick={startImport}
          >
            Import candidates
          </button>
          {lastImport ? <span className="muted">{runLine(lastImport)}</span> : null}
        </div>
        {lastImport && lastImport.status !== 'running' ? (
          <ul className="seeding-sources">
            {sourceLines(lastImport).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </section>

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
              {t.label} ({counts[t.tab]})
            </button>
          ))}
        </div>
        <span className="muted">{overview.matchedRecords} already in the catalog</span>
      </div>

      {tab === 'new' && candidates.length > 0 ? (
        <div className="seeding-bar">
          <button
            type="button"
            disabled={busy}
            onClick={() => setTicked(new Set(candidates.map((c) => c.id)))}
          >
            Select all
          </button>
          <button type="button" disabled={busy} onClick={() => setTicked(new Set())}>
            Clear
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || selected.length === 0}
            onClick={sendToDrafting}
          >
            Send {selected.length} to drafting
          </button>
        </div>
      ) : null}

      {notice && !error ? (
        <output className="saved" aria-live="polite">
          {notice}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {candidates.length === 0 ? <p className="muted">{empty}</p> : null}
      {candidates.length > 0 ? (
        <ul className="rows">
          {candidates.map((c) => (
            <CandidateRow
              key={c.id}
              candidate={c}
              busy={busy}
              ticked={ticked.has(c.id)}
              onToggle={() => toggle(c.id)}
              act={act}
            />
          ))}
        </ul>
      ) : null}

      <p className="seeding-attribution muted">
        {SEEDING_SOURCES.map((s) => SOURCE_ATTRIBUTION[s]).join(' · ')}
      </p>
    </>
  );
}

function CandidateRow({
  candidate: c,
  busy,
  ticked,
  onToggle,
  act,
}: {
  candidate: SeedingCandidate;
  busy: boolean;
  ticked: boolean;
  onToggle: () => void;
  act: (action: () => Promise<string>) => void;
}) {
  const reviewable = c.status !== 'dismissed';
  return (
    <li className="block-row seeding-row">
      {c.status === 'new' ? (
        <input
          type="checkbox"
          aria-label={`Tick ${c.name}`}
          checked={ticked}
          disabled={busy}
          onChange={onToggle}
        />
      ) : null}
      <div className="block-text">
        <span className="block-title">
          <strong>{c.name}</strong>
          <span className="chip neutral">{PLACE_CATEGORY_LABELS[c.placeCategory]}</span>
          {c.draft ? (
            <Link
              className={`chip ${DRAFT_LABELS[c.draft.status].tone}`}
              to="/admin/curation?kind=draft"
            >
              {DRAFT_LABELS[c.draft.status].label}
            </Link>
          ) : null}
        </span>
        <span className="chips">
          {c.sources.map((s) =>
            s.sourceUrl ? (
              <a
                key={s.id}
                className="chip neutral"
                href={s.sourceUrl}
                target="_blank"
                rel="noreferrer"
                title={s.licence}
              >
                {SEEDING_SOURCE_LABELS[s.source]}
              </a>
            ) : (
              <span key={s.id} className="chip neutral" title={s.licence}>
                {SEEDING_SOURCE_LABELS[s.source]}
              </span>
            ),
          )}
          <span className="muted">{km(c.distanceM)} km from the centre</span>
        </span>
        {reviewable
          ? c.possibleDuplicates.map((d) => (
              <span key={d.id} className="seeding-dup">
                <span>
                  Possibly the same place as {d.name} ({d.distanceM} m)
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await seeding.merge(d.id, c.id);
                      return `${d.name} merged into ${c.name}.`;
                    })
                  }
                >
                  Merge
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await seeding.keepApart(c.id, d.id);
                      return `${c.name} and ${d.name} kept separate.`;
                    })
                  }
                >
                  Keep separate
                </button>
              </span>
            ))
          : null}
        {c.sources.length > 1 ? (
          <details className="seeding-rows">
            <summary>Sources ({c.sources.length})</summary>
            <ul>
              {c.sources.map((s) => (
                <li key={s.id}>
                  <span>
                    {s.name} <span className="muted">· {SEEDING_SOURCE_LABELS[s.source]}</span>
                  </span>
                  {c.status === 'new' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await seeding.split(s.id);
                          return `${s.name} split off into its own candidate.`;
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
        ) : null}
      </div>
      {c.status === 'new' ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act(async () => {
              await seeding.dismiss(c.id);
              return `${c.name} dismissed. It is under Dismissed.`;
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
          onClick={() =>
            act(async () => {
              await seeding.restore(c.id);
              return `${c.name} restored to New.`;
            })
          }
        >
          Restore
        </button>
      ) : null}
    </li>
  );
}
