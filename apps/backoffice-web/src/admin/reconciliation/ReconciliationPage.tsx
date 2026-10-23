import type { FindingKind, ReconcileError } from '@fetivi/domain/payments-vocabulary';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ReconciliationFinding, type ReconciliationRun, reconciliation } from '../../api';
import { useAction } from '../../useAction';

type Tab = 'needs_attention' | 'resolved';

const KIND_LABELS: Record<FindingKind, string> = {
  session_completed: 'Payment completed, webhook missed',
  session_expired: 'Checkout expired, webhook missed',
  intent_canceled: 'Card authorization lapsed',
  intent_captured: 'Capture recorded late',
  refund_succeeded: 'Refund completed, webhook missed',
  refund_failed: 'Refund failed at Stripe',
  hold_expired: 'Hold past expiry',
  hold_on_active_order: 'Hold past expiry on an active Order',
  orphan_session: 'Stripe checkout with no Order',
  check_failed: 'Check failed',
};

const RUN_ERRORS: Record<ReconcileError, string> = {
  'stripe-not-configured': 'Stripe is not configured, so only holds were checked',
  'stripe-unavailable': 'Stripe was unavailable, so only holds were checked',
};

/** The stored action is `<what was fed>: <machine outcome>`; the admin reads it in words. */
const ACTIONS: Record<string, string> = {
  authorize: 'Payment authorized',
  'session expired': 'Checkout expiry recorded',
  void: 'Authorization void recorded',
  capture: 'Capture recorded',
  refunded: 'Refund recorded',
  'refund failed': 'Refund failure recorded',
  expire: 'Order expired',
  fail: 'Order failed, admin alerted',
  release: 'Hold released',
};

const OUTCOMES: Record<string, string> = {
  unchanged: 'already up to date',
  stale: 'older proposal, nothing changed',
  rejected: 'refused',
};

function actionText(action: string): string {
  const [what = action, outcome = 'applied'] = action.split(': ');
  const done = ACTIONS[what] ?? what;
  return outcome === 'applied' ? done : `${done} (${OUTCOMES[outcome] ?? outcome})`;
}

/** How long after Run now the page reloads once; a run takes seconds. */
const RELOAD_AFTER_MS = 5000;

const time = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function runLine(run: ReconciliationRun): string {
  const at = time(run.startedAt);
  if (!run.finishedAt) return `${at} did not finish.`;
  const open = run.found - run.resolved;
  const counts = `checked ${run.checked} · ${run.resolved} put right · ${open} need attention`;
  const error = run.error ? ` · ${RUN_ERRORS[run.error]}` : '';
  return `${at} · ${counts}${error}`;
}

function lastRunLine(run: ReconciliationRun | undefined): string {
  return run ? `Last run ${runLine(run)}` : 'No run yet. The job runs every 5 minutes.';
}

export function ReconciliationPage() {
  const { busy, error, run } = useAction();
  const [tab, setTab] = useState<Tab>('needs_attention');
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [findings, setFindings] = useState<ReconciliationFinding[] | null>(null);
  const [queued, setQueued] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTab = useCallback(async () => {
    const result = await reconciliation.list(tab);
    setRuns(result.runs);
    setFindings(result.findings);
  }, [tab]);

  useEffect(() => {
    setFindings(null);
    void run(fetchTab);
  }, [run, fetchTab]);

  useEffect(
    () => () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    },
    [],
  );

  const runNow = () =>
    run(async () => {
      await reconciliation.run();
      setQueued(true);
      reloadTimer.current = setTimeout(() => {
        setQueued(false);
        void run(fetchTab);
      }, RELOAD_AFTER_MS);
    });

  return (
    <>
      <div className="page-head">
        <h1>Reconciliation</h1>
        <button type="button" className="primary" disabled={busy || queued} onClick={runNow}>
          <ArrowsClockwise aria-hidden="true" weight="bold" />
          Run now
        </button>
      </div>
      <p className="muted">
        {queued ? 'Run queued. It finishes within a minute.' : lastRunLine(runs[0])}
      </p>
      {runs.length > 1 ? (
        <details className="help">
          <summary>Earlier runs</summary>
          {runs.slice(1).map((r) => (
            <p key={r.id} className="muted">
              {runLine(r)}
            </p>
          ))}
        </details>
      ) : null}
      <div className="segmented" role="tablist" aria-label="Status">
        {(['needs_attention', 'resolved'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'needs_attention' ? 'Needs attention' : 'Resolved'}
          </button>
        ))}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {findings === null && !error ? <p className="muted">Loading…</p> : null}
      {findings?.length === 0 ? (
        <p className="muted">
          {tab === 'needs_attention' ? 'Nothing needs attention.' : 'Nothing found yet.'}
        </p>
      ) : null}
      {findings && findings.length > 0 ? (
        <ul className="rows">
          {findings.map((f) => (
            <li key={f.id} className="block-row">
              <div className="block-text">
                <strong>{KIND_LABELS[f.kind]}</strong>
                <span className="muted">
                  {[
                    f.orderId ? `Order ${f.orderId.slice(0, 8)}` : null,
                    f.detail,
                    f.action ? actionText(f.action) : null,
                    f.status === 'dismissed' ? 'marked resolved' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="muted">
                  {f.firstSeenAt === f.lastSeenAt
                    ? `Seen ${time(f.lastSeenAt)}`
                    : `First seen ${time(f.firstSeenAt)} · last seen ${time(f.lastSeenAt)}`}
                </span>
              </div>
              {f.status === 'needs_attention' ? (
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Mark this finding resolved? If the problem is still there, the next run reports it again.',
                        )
                      ) {
                        void run(async () => {
                          await reconciliation.resolve(f.id);
                          setFindings((rows) => rows?.filter((r) => r.id !== f.id) ?? null);
                        });
                      }
                    }}
                  >
                    Mark resolved
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
