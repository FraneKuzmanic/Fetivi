import {
  ArrowSquareOut,
  CheckCircle,
  CreditCard,
  Hourglass,
  WarningCircle,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { host, type PaymentsStatus } from '../../api';
import { useConfirm } from '../../shell/ConfirmDialog';
import { useAction } from '../../useAction';
import { SettingsTabs } from './SettingsTabs';

export type PaymentsState = 'not_connected' | 'action_needed' | 'verifying' | 'connected';

/**
 * Stripe's capability states folded into the four a host acts on. An account that exists but never
 * finished onboarding, and one Stripe restricted or cannot serve, all need the host on Stripe.
 */
export function paymentsState(status: PaymentsStatus): PaymentsState {
  if (!status.stripeConnected) return 'not_connected';
  if (status.stripeCardPayments === 'active') return 'connected';
  if (status.stripeCardPayments === 'pending') return 'verifying';
  return 'action_needed';
}

const COPY: Record<
  PaymentsState,
  { chip: string; tone: string; text: string; icon: typeof CheckCircle }
> = {
  not_connected: {
    chip: 'Not connected',
    tone: 'neutral',
    text: 'Connect a Stripe account so guests can pay for your services by card. Until then, guests pay you directly. If you already use Stripe, sign in with it on the next page.',
    icon: CreditCard,
  },
  action_needed: {
    chip: 'Action needed',
    tone: 'wait',
    text: 'Stripe needs a few more details before guests can pay by card. It takes a few minutes on Stripe.',
    icon: WarningCircle,
  },
  verifying: {
    chip: 'Being verified',
    tone: 'wait',
    text: 'Stripe is checking your details. This page shows the result when you open it again.',
    icon: Hourglass,
  },
  connected: {
    chip: 'Connected',
    tone: 'ok',
    text: 'Guests can pay for your services by card. The money goes straight to your Stripe account; Fetivi takes no commission.',
    icon: CheckCircle,
  },
};

const DASHBOARD = 'https://dashboard.stripe.com/';

/**
 * Settings → Payments: the host's own Stripe account for card payments (38). The status is read
 * again on every visit and on the way back from Stripe, so there is nothing to refresh by hand.
 */
export function PaymentsPage() {
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const [status, setStatus] = useState<PaymentsStatus | null>(null);
  const [params, setParams] = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (params.get('stripe')) {
      setParams(
        (p) => {
          p.delete('stripe');
          return p;
        },
        { replace: true },
      );
    }
    void run(async () => {
      const current = await host.payments();
      setStatus(current);
      // An account that is not active yet may have changed on Stripe since the last look.
      if (current.stripeConnected && current.stripeCardPayments !== 'active') {
        setStatus(await host.paymentsRefresh());
      }
    });
  }, [params, setParams, run]);

  const openStripe = () =>
    void run(async () => {
      const link = await host.paymentsLink();
      window.location.assign(link.url);
    });

  const disconnect = async () => {
    if (
      !(await confirm({
        title: 'Disconnect Stripe?',
        body: 'New card payments stop and guests pay you directly until you connect an account again. Payments and refunds you already have stay in your Stripe Dashboard, and your Stripe account is not closed.',
        action: 'Disconnect',
        danger: true,
      }))
    ) {
      return;
    }
    void run(async () => setStatus(await host.paymentsDisconnect()));
  };

  const state = status ? paymentsState(status) : null;
  const copy = state ? COPY[state] : null;

  return (
    <>
      <SettingsTabs />
      <section className="panel payments" aria-labelledby="payments-heading">
        <div className="payments-head">
          <h2 id="payments-heading">Card payments for your services</h2>
          {copy ? <span className={`chip ${copy.tone}`}>{copy.chip}</span> : null}
        </div>
        {status === null && !error ? <p className="muted">Loading…</p> : null}
        {copy ? (
          <p className="payments-text">
            <copy.icon aria-hidden="true" className={`payments-icon ${copy.tone}`} />
            <span>{copy.text}</span>
          </p>
        ) : null}
        {state ? (
          <div className="actions">
            {state === 'not_connected' ? (
              <button type="button" className="primary" disabled={busy} onClick={openStripe}>
                Connect Stripe
              </button>
            ) : null}
            {state === 'action_needed' ? (
              <button type="button" className="primary" disabled={busy} onClick={openStripe}>
                Finish setup on Stripe
              </button>
            ) : null}
            {state === 'connected' || state === 'verifying' ? (
              <a className="button" href={DASHBOARD} target="_blank" rel="noreferrer">
                <ArrowSquareOut aria-hidden="true" />
                Open Stripe Dashboard
              </a>
            ) : null}
            {state !== 'not_connected' ? (
              <button type="button" className="danger" disabled={busy} onClick={disconnect}>
                Disconnect
              </button>
            ) : null}
          </div>
        ) : null}
        {state && state !== 'not_connected' ? (
          <small className="muted">
            To use a different Stripe account, disconnect this one, then connect again.
          </small>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </>
  );
}
