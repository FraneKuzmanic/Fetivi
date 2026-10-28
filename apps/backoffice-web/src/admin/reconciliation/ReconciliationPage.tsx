import type { FindingKind } from '@fetivi/domain/payments-vocabulary';
import { ArrowsClockwise, Scales } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type ReconciliationFinding, reconciliation } from '../../api';
import { formatMoment } from '../../forms/datetime';
import { i18next } from '../../i18n';
import { EmptyState } from '../../shell/EmptyState';
import { usePageTitle } from '../../shell/PageTitle';
import { Tabs } from '../../shell/Tabs';
import { useAction } from '../../useAction';

type Tab = 'needs_attention' | 'resolved';

const t = i18next.getFixedT(null, 'admin', 'reconciliation');

/** The stored action is `<what was fed>: <machine outcome>`; the admin reads it in words. */
const ACTIONS = {
  authorize: 'authorize',
  'session expired': 'sessionExpired',
  void: 'void',
  capture: 'capture',
  refunded: 'refunded',
  'refund failed': 'refundFailed',
  expire: 'expire',
  fail: 'fail',
  release: 'release',
} as const;

const OUTCOMES = ['unchanged', 'stale', 'rejected'] as const;

function actionText(action: string): string {
  const [what = action, outcome = 'applied'] = action.split(': ');
  const key = ACTIONS[what as keyof typeof ACTIONS];
  const done = key ? t(`actions.${key}`) : what;
  if (outcome === 'applied') return done;
  const known = (OUTCOMES as readonly string[]).includes(outcome);
  return t('withOutcome', {
    action: done,
    outcome: known ? t(`outcomes.${outcome as (typeof OUTCOMES)[number]}`) : outcome,
  });
}

/** How long after Run now the page reloads once; a run takes seconds. */
const RELOAD_AFTER_MS = 5000;

const time = formatMoment;

/** Where a finding's subject lives in the admin, if it has a page. */
function SubjectLink({ subject }: { subject: ReconciliationFinding['subject'] }) {
  if (!subject) return null;
  if (subject.kind === 'payment') return <span className="cell-sub">{subject.label}</span>;
  const to =
    subject.kind === 'order' ? `/admin/orders/${subject.id}` : `/admin/providers/${subject.id}`;
  return (
    <span className="cell-sub">
      {subject.kind === 'order' ? t('order') : t('provider')}
      <Link to={to}>{subject.label}</Link>
    </span>
  );
}

/** /admin/reconciliation: what the payment check could not put right on its own. */
export function ReconciliationPage() {
  useTranslation('admin');
  const { busy, error, run } = useAction();
  const [tab, setTab] = useState<Tab>('needs_attention');
  const [findings, setFindings] = useState<ReconciliationFinding[] | null>(null);
  const [queued, setQueued] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchTab = useCallback(async () => {
    const result = await reconciliation.list(tab);
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

  usePageTitle(t('title'));

  return (
    <>
      <div className="tabs-row">
        <Tabs
          label={t('status')}
          items={[
            { id: 'needs_attention', label: t('needsYou') },
            { id: 'resolved', label: t('resolved') },
          ]}
          value={tab}
          onChange={setTab}
        />
        <button type="button" className="primary" disabled={busy || queued} onClick={runNow}>
          <ArrowsClockwise aria-hidden="true" weight="bold" />
          {t('checkNow')}
        </button>
      </div>
      {queued ? (
        <output className="saved" aria-live="polite">
          {t('started')}
        </output>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {findings === null && !error ? <p className="muted">{i18next.t('common:loading')}</p> : null}
      {findings?.length === 0 ? (
        tab === 'needs_attention' ? (
          <EmptyState icon={Scales} title={t('caughtUp')}>
            {t('caughtUpBody')}
          </EmptyState>
        ) : (
          <EmptyState icon={Scales} title={t('noneResolved')}>
            {t('noneResolvedBody')}
          </EmptyState>
        )
      ) : null}
      {findings && findings.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('problem')}</th>
                <th scope="col" className="wide-only">
                  {t('whatDone')}
                </th>
                <th scope="col" className="wide-only">
                  {t('seen')}
                </th>
                <th scope="col">
                  <span className="visually-hidden">{i18next.t('common:table.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td>
                    <div className="cell-main">
                      <strong>{t(`kinds.${f.kind as FindingKind}`)}</strong>
                      <SubjectLink subject={f.subject} />
                      {f.detail ? (
                        <details className="tech-details">
                          <summary>{t('technical')}</summary>
                          <span className="mono-text">{f.detail}</span>
                        </details>
                      ) : null}
                    </div>
                  </td>
                  <td className="wide-only">
                    {[
                      f.action ? actionText(f.action) : t('nothingYet'),
                      f.status === 'dismissed' ? t('markedResolved') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                  <td className="nowrap wide-only">
                    {f.firstSeenAt === f.lastSeenAt ? (
                      time(f.lastSeenAt)
                    ) : (
                      <div className="cell-main">
                        <span>{t('last', { when: time(f.lastSeenAt) })}</span>
                        <span className="cell-sub">
                          {t('first', { when: time(f.firstSeenAt) })}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="cell-actions">
                    {f.status === 'needs_attention' ? (
                      <button type="button" disabled={busy} onClick={() => resolve(f)}>
                        {t('markResolved')}
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
