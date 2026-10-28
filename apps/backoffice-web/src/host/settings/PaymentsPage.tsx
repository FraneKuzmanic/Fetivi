import {
  ArrowSquareOut,
  CheckCircle,
  CreditCard,
  Hourglass,
  WarningCircle,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { host, type PaymentsStatus } from '../../api';
import { i18next } from '../../i18n';
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

const copyOf = (): Record<
  PaymentsState,
  { chip: string; tone: string; text: string; icon: typeof CheckCircle }
> => ({
  not_connected: {
    chip: i18next.t('host:services.notConnected'),
    tone: 'neutral',
    text: i18next.t('host:settings.notConnectedText'),
    icon: CreditCard,
  },
  action_needed: {
    chip: i18next.t('host:services.actionNeeded'),
    tone: 'wait',
    text: i18next.t('host:settings.actionNeededText'),
    icon: WarningCircle,
  },
  verifying: {
    chip: i18next.t('host:services.verifying'),
    tone: 'wait',
    text: i18next.t('host:settings.verifyingText'),
    icon: Hourglass,
  },
  connected: {
    chip: i18next.t('host:services.connected'),
    tone: 'ok',
    text: i18next.t('host:settings.connectedText'),
    icon: CheckCircle,
  },
});

const DASHBOARD = 'https://dashboard.stripe.com/';

/**
 * Settings → Payments: the host's own Stripe account for card payments (38). The status is read
 * again on every visit and on the way back from Stripe, so there is nothing to refresh by hand.
 */
export function PaymentsPage() {
  const { t } = useTranslation(['host', 'common']);
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
        title: t('settings.disconnectTitle'),
        body: t('settings.disconnectBody'),
        action: t('settings.disconnect'),
        danger: true,
      }))
    ) {
      return;
    }
    void run(async () => setStatus(await host.paymentsDisconnect()));
  };

  const state = status ? paymentsState(status) : null;
  const copy = state ? copyOf()[state] : null;

  return (
    <>
      <SettingsTabs />
      <section className="panel payments" aria-labelledby="payments-heading">
        <div className="payments-head">
          <h2 id="payments-heading">{t('settings.cardPayments')}</h2>
          {copy ? <span className={`chip ${copy.tone}`}>{copy.chip}</span> : null}
        </div>
        {status === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
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
                {t('settings.connect')}
              </button>
            ) : null}
            {state === 'action_needed' ? (
              <button type="button" className="primary" disabled={busy} onClick={openStripe}>
                {t('settings.finish')}
              </button>
            ) : null}
            {state === 'connected' || state === 'verifying' ? (
              <a className="button" href={DASHBOARD} target="_blank" rel="noreferrer">
                <ArrowSquareOut aria-hidden="true" />
                {t('settings.dashboard')}
              </a>
            ) : null}
            {state !== 'not_connected' ? (
              <button type="button" className="danger" disabled={busy} onClick={disconnect}>
                {t('settings.disconnect')}
              </button>
            ) : null}
          </div>
        ) : null}
        {state && state !== 'not_connected' ? (
          <small className="muted">{t('settings.otherAccount')}</small>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </>
  );
}
