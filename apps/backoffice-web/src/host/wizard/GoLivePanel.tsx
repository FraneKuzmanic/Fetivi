import { GO_LIVE_ITEMS, GO_LIVE_TARGETS, wizardStepPath } from '@fetivi/domain/wizard';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import { host, type WizardStatus } from '../../api';
import { useWizardCopy } from './copy';

const POLL_MS = 5000;

/** The unit page's guest guide section, as its `?section=` value. */
export const UNIT_BLOCKS_ID = 'guide';

/**
 * The go-live minimum as a checklist, and the Go live button. While translations are the only
 * thing pending it refreshes itself, so the button enables without a reload.
 */
export function GoLivePanel({
  status,
  busy,
  onGoLive,
  onRefresh,
}: {
  status: WizardStatus;
  busy: boolean;
  onGoLive: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { goLive, ui } = useWizardCopy();
  const headingId = useId();
  const missing = new Set(status.goLive.missing);
  const translating = !status.live && missing.has('translations');
  const latest = useRef(onRefresh);
  latest.current = onRefresh;

  useEffect(() => {
    if (!translating) return;
    const timer = setInterval(() => {
      // A failed background refresh is ignored; the next tick tries again.
      latest.current().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [translating]);

  const fieldsMissing = status.goLive.missing.some((i) => GO_LIVE_TARGETS[i] !== null);
  const summary = status.live ? goLive.live : status.goLive.ready ? goLive.ready : goLive.notReady;

  return (
    <section className="panel go-live" aria-labelledby={headingId}>
      <h2 id={headingId}>{goLive.title}</h2>
      <p className={status.live ? 'go-live-state live' : 'muted'}>{summary}</p>
      {status.live ? (
        <a href={host.qrUrl(status.unitId, 'svg')} target="_blank" rel="noreferrer">
          {goLive.openQr}
        </a>
      ) : null}
      {status.live && fieldsMissing ? (
        <p className="warning" role="status">
          {goLive.noLongerMet}
        </p>
      ) : null}
      <ul className="checklist">
        {GO_LIVE_ITEMS.map((item) => {
          const done = !missing.has(item);
          const target = GO_LIVE_TARGETS[item];
          // Translations have no wizard field: the link goes to the unit's blocks.
          const to = target
            ? wizardStepPath(status.unitId, target.stepId, target.fieldId)
            : item === 'translations'
              ? `/units/${status.unitId}?section=${UNIT_BLOCKS_ID}`
              : null;
          return (
            <li key={item} className={done ? 'checklist-item done' : 'checklist-item'}>
              {done ? (
                <CheckCircle weight="fill" aria-hidden="true" />
              ) : (
                <Circle aria-hidden="true" />
              )}
              <span className="checklist-text">
                {done || !to ? goLive[item] : <Link to={to}>{goLive[item]}</Link>}
                {!done && item === 'approval' ? <small>{goLive.waitingApproval}</small> : null}
                {!done && item === 'translations' ? (
                  <small>{goLive.translationsPending}</small>
                ) : null}
              </span>
              <span className="visually-hidden">{done ? ui.stepDone : ui.notSet}</span>
            </li>
          );
        })}
      </ul>
      {status.live ? null : (
        <div className="actions">
          <button
            type="button"
            className="primary"
            disabled={busy || !status.goLive.ready}
            onClick={onGoLive}
          >
            {goLive.button}
          </button>
        </div>
      )}
    </section>
  );
}
