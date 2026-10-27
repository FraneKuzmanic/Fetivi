import type { FindingKind, ReconcileError } from '@fetivi/domain/payments-vocabulary';
import { ArrowsClockwise, Scales } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { type ReconciliationFinding, type ReconciliationRun, reconciliation } from '../../api';
import { formatMoment } from '../../forms/datetime';
import { EmptyState } from '../../shell/EmptyState';
import { Tabs } from '../../shell/Tabs';
import { useAction } from '../../useAction';

type Tab = 'needs_attention' | 'resolved';

const KIND_LABELS: Record<FindingKind, string> = {
  session_completed: 'Payment went through, but Fetivi missed it',
  session_expired: 'Checkout ran out, but Fetivi missed it',
  intent_canceled: 'Card hold ran out',
  intent_captured: 'Payment taken, recorded late',
  refund_succeeded: 'Refund went through, but Fetivi missed it',
  refund_failed: 'Refund failed at Stripe',
  hold_expired: 'Card hold past its end',
  hold_on_active_order: 'Card hold ended on an active order',
  orphan_session: 'Stripe payment with no order',
  check_failed: 'Couldn’t check a payment',
};

const RUN_ERRORS: Record<ReconcileError, string> = {
  'stripe-not-configured': 'Stripe is not configured, so only holds were checked',
  'stripe-unavailable': 'Stripe was unavailable, so only holds were checked',
};

/** The stored action is `<what was fed>: <machine outcome>`; the admin reads it in words. */
const ACTIONS: Record<string, string> = {
  authorize: 'Card hold recorded',
  'session expired': 'Checkout expiry recorded',
  void: 'Released hold recorded',
  capture: 'Payment recorded',
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

const time = formatMoment;

function runLine(run: ReconciliationRun): string {
  const at = time(run.startedAt);
  if (!run.finishedAt) return `${at} did not finish.`;
  const open = run.found - run.resolved;
  const counts = `${run.checked} checked · ${run.resolved} fixed · ${open} need you`;
  const error = run.error ? ` · ${RUN_ERRORS[run.error]}` : '';
  return `${at} · ${counts}${error}`;
}

function lastRunLine(run: ReconciliationRun | undefined): string {
  return run ? `Last check ${runLine(run)}` : 'No check yet. It runs every 5 minutes.';
}

/** Where a finding's subject lives in the admin, if it has a page. */
function SubjectLink({ subject }: { subject: ReconciliationFinding['subject'] }) {
  if (!subject) return null;
  if (subject.kind === 'payment') return <span className="cell-sub">{subject.label}</span>;
  const to =
    subject.kind === 'order' ? `/admin/orders/${subject.id}` : `/admin/providers/${subject.id}`;
  return (
    <span className="cell-sub">
      {subject.kind === 'order' ? 'Order: ' : 'Provider: '}
      <Link to={to}>{subject.label}</Link>
    </span>
  );
}

/** /admin/reconciliation: what the payment check could not put right on its own. */
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

  const resolve = (f: ReconciliationFinding) =>
    void run(async () => {
      await reconciliation.resolve(f.id);
      setFindings((rows) => rows?.filter((r) => r.id !== f.id) ?? null);
    });

  return (
    <>
      <div className="page-head">
        <h1>Payment checks</h1>
        <button type="button" className="primary" disabled={busy || queued} onClick={runNow}>
          <ArrowsClockwise aria-hidden="true" weight="bold" />
          Check now
        </button>
      </div>
      <p className="muted">
        Every 5 minutes Fetivi compares its orders with Stripe and fixes what it can. What it can’t
        fix waits here.
      </p>
      <p className="muted">
        {queued ? 'Check started. It finishes within a minute.' : lastRunLine(runs[0])}
      </p>
      {runs.length > 1 ? (
        <details className="help">
          <summary>Earlier checks</summary>
          {runs.slice(1).map((r) => (
            <p key={r.id} className="muted">
              {runLine(r)}
            </p>
          ))}
        </details>
      ) : null}
      <Tabs
        label="Status"
        items={[
          { id: 'needs_attention', label: 'Needs you' },
          { id: 'resolved', label: 'Resolved' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {error ? <p role="alert">{error}</p> : null}
      {findings === null && !error ? <p className="muted">Loading…</p> : null}
      {findings?.length === 0 ? (
        tab === 'needs_attention' ? (
          <EmptyState icon={Scales} title="All caught up">
            Every payment matches Stripe, or the check put it right on its own.
          </EmptyState>
        ) : (
          <EmptyState icon={Scales} title="Nothing resolved yet">
            Problems you mark resolved are listed here.
          </EmptyState>
        )
      ) : null}
      {findings && findings.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Problem</th>
                <th scope="col" className="wide-only">
                  What Fetivi did
                </th>
                <th scope="col" className="wide-only">
                  Seen
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div className="cell-main">
                      <strong>{KIND_LABELS[f.kind]}</strong>
                      <SubjectLink subject={f.subject} />
                      {f.detail ? (
                        <details className="tech-details">
                          <summary>Technical details</summary>
                          <span className="mono-text">{f.detail}</span>
                        </details>
                      ) : null}
                    </div>
                  </td>
                  <td className="wide-only">
                    {[
                      f.action ? actionText(f.action) : 'Nothing yet',
                      f.status === 'dismissed' ? 'marked resolved' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                  <td className="nowrap wide-only">
                    {f.firstSeenAt === f.lastSeenAt ? (
                      time(f.lastSeenAt)
                    ) : (
                      <div className="cell-main">
                        <span>Last {time(f.lastSeenAt)}</span>
                        <span className="cell-sub">First {time(f.firstSeenAt)}</span>
                      </div>
                    )}
                  </td>
                  <td className="cell-actions">
                    {f.status === 'needs_attention' ? (
                      <button type="button" disabled={busy} onClick={() => resolve(f)}>
                        Mark resolved
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
