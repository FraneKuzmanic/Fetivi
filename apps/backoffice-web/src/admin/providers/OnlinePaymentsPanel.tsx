import type { ProviderCardStatus } from '@fetivi/domain/payments-vocabulary';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { type Provider, providers } from '../../api';
import { CopyButton } from '../../host/stays/StayPage';
import { useAction } from '../../useAction';

type Status = ProviderCardStatus | 'none';

const STATUS: Record<Status, { chip: string; tone: string; text: string }> = {
  none: { chip: 'Not set up', tone: 'neutral', text: 'Offers paid online need a Stripe account.' },
  pending: {
    chip: 'Onboarding',
    tone: 'wait',
    text: 'Waiting for the Provider to finish Stripe onboarding.',
  },
  active: { chip: 'Active', tone: 'ok', text: 'Can take card payments.' },
  restricted: {
    chip: 'Restricted',
    tone: 'fail',
    text: 'Stripe needs more information from the Provider.',
  },
  unsupported: {
    chip: 'Unsupported',
    tone: 'fail',
    text: "Stripe can't take card payments for this account.",
  },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Stripe Connect onboarding for one Provider: the card capability status, a fresh onboarding link
 * to send the Provider (the Provider is the merchant of record) and a Refresh. Returning from
 * Stripe (`?stripe=return|refresh`) refreshes once.
 */
export function OnlinePaymentsPanel({
  provider,
  onChange,
}: {
  provider: Provider;
  onChange: (provider: Provider) => void;
}) {
  const { busy, error, run } = useAction();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [params, setParams] = useSearchParams();
  const returned = useRef(false);
  const { id } = provider;

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
    void run(async () => onChange(await providers.stripeRefresh(id)));
  }, [params, setParams, run, onChange, id]);

  const status = STATUS[provider.stripeCardPayments ?? 'none'];

  return (
    <section className="panel" aria-labelledby="online-payments">
      <h2 id="online-payments">Online payments</h2>
      <p>
        <span className={`chip ${status.tone}`}>{status.chip}</span> {status.text}
      </p>
      {provider.stripeCheckedAt ? (
        <small className="muted">Last checked {when(provider.stripeCheckedAt)}</small>
      ) : null}

      {link ? (
        <div className="onboarding-link">
          <label className="field-label" htmlFor="onboarding-link">
            Onboarding link for the Provider
          </label>
          <input id="onboarding-link" type="text" value={link.url} readOnly />
          <div className="actions">
            <CopyButton text={link.url} label="Copy" />
            <a className="button" href={link.url} target="_blank" rel="noreferrer">
              <ArrowSquareOut aria-hidden="true" />
              Open
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
          className={provider.stripeCardPayments === 'active' ? undefined : 'primary'}
          disabled={busy}
          onClick={() => void run(async () => setLink(await providers.stripeOnboardingLink(id)))}
        >
          Create onboarding link
        </button>
        {/* A created link means the account exists, even before this page reloads. */}
        {provider.stripeConnected || link ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => onChange(await providers.stripeRefresh(id)))}
          >
            Refresh status
          </button>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
