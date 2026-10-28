import type { ProviderCardStatus } from '@fetivi/domain/payments-vocabulary';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { PaymentsStatus } from '../../api';
import { CopyButton } from '../../host/stays/StayPage';
import { i18next, localeOf } from '../../i18n';
import { useAction } from '../../useAction';

type Status = ProviderCardStatus | 'none';
const statusOf = (): Record<Status, { chip: string; tone: string; text: string }> => ({
  none: {
    chip: i18next.t('admin:providers.notSetUp'),
    tone: 'neutral',
    text: i18next.t('admin:providers.notSetUpText'),
  },
  pending: {
    chip: i18next.t('admin:providers.onboarding'),
    tone: 'wait',
    text: i18next.t('admin:providers.onboardingText'),
  },
  active: {
    chip: i18next.t('admin:providers.active'),
    tone: 'ok',
    text: i18next.t('admin:providers.activeText'),
  },
  restricted: {
    chip: i18next.t('admin:providers.restricted'),
    tone: 'fail',
    text: i18next.t('admin:providers.restrictedText'),
  },
  unsupported: {
    chip: i18next.t('admin:providers.unsupported'),
    tone: 'fail',
    text: i18next.t('admin:providers.unsupportedText'),
  },
});

const when = (iso: string) =>
  new Date(iso).toLocaleString(localeOf(i18next.language), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/**
 * A Provider's Stripe Connect onboarding: the card capability status, a fresh onboarding link the
 * admin copies to send on, and a Refresh. Returning from Stripe (`?stripe=return|refresh`)
 * refreshes once. Hosts manage their own account in Settings → Payments.
 */
export function OnlinePaymentsPanel<T extends PaymentsStatus>({
  title,
  status: current,
  onLink,
  onRefresh,
  onChange,
}: {
  title?: string;
  status: T;
  onLink: () => Promise<{ url: string; expiresAt: string }>;
  onRefresh: () => Promise<T>;
  onChange: (status: T) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const { busy, error, run } = useAction();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [params, setParams] = useSearchParams();
  const returned = useRef(false);

  useEffect(() => {
    if (returned.current || !params.get('stripe')) return;
    returned.current = true;
    setParams(
      (p) => {
        p.delete('stripe');
        return p;
      },
      { replace: true },
    );
    void run(async () => onChange(await onRefresh()));
  }, [params, setParams, run, onChange, onRefresh]);

  const status = statusOf()[current.stripeCardPayments ?? 'none'];
  const active = current.stripeCardPayments === 'active';

  return (
    <section className="panel" aria-labelledby="online-payments">
      <h2 id="online-payments">{title ?? t('providers.onlinePayments')}</h2>
      <p>
        <span className={`chip ${status.tone}`}>{status.chip}</span> {status.text}
      </p>
      {current.stripeCheckedAt ? (
        <small className="muted">Last checked {when(current.stripeCheckedAt)}</small>
      ) : null}

      {link ? (
        <div className="onboarding-link">
          <label className="field-label" htmlFor="onboarding-link">
            {t('providers.onboardingLink')}
          </label>
          <input id="onboarding-link" type="text" value={link.url} readOnly />
          <div className="actions">
            <CopyButton text={link.url} label={t('providers.copy')} />
            <a className="button" href={link.url} target="_blank" rel="noreferrer">
              <ArrowSquareOut aria-hidden="true" />
              {t('providers.open')}
            </a>
          </div>
          <small className="muted">
            Single use. Expires {when(link.expiresAt)}; create a new one after that.
          </small>
        </div>
      ) : null}

      <div className="actions">
        <button
          type="button"
          className={active ? undefined : 'primary'}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setLink(await onLink());
            })
          }
        >
          {t('providers.createLink')}
        </button>
        {/* A created link means the account exists, even before this page reloads. */}
        {current.stripeConnected || link ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => onChange(await onRefresh()))}
          >
            {t('providers.refresh')}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
