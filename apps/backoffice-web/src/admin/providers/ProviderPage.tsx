import {
  OFFER_LIMITS,
  PROVIDER_DEFAULTS,
  PROVIDER_LANGUAGES,
  type ProviderLanguage,
} from '@fetivi/domain/offer-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import { CaretRight, Plus } from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type OfferSummary, type Provider, type ProviderInput, providers } from '../../api';
import {
  CheckboxField,
  NumberField,
  Section,
  SelectField,
  TextArea,
  TextField,
} from '../../forms/fields';
import {
  AVAILABILITY_MODE_SHORT,
  OFFER_CATEGORY_LABELS,
  PROVIDER_LANGUAGE_LABELS,
} from '../../forms/labels';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useAction } from '../../useAction';
import { bpFromPercent, formatPrice, percentFromBp } from './money';
import { OnlinePaymentsPanel } from './OnlinePaymentsPanel';

const WHATSAPP_HINT = 'Stored for order links by WhatsApp later; email is used for now.';
const LANGUAGE_LABEL = 'Language for order emails';
const LANGUAGE_HINT = 'Also the language of the order page the email links to.';

interface Draft {
  name: string | null;
  email: string | null;
  whatsappPhone: string | null;
  language: ProviderLanguage;
  taxNumber: string | null;
  commissionPercent: number | null;
  dealNotes: string | null;
  active: boolean;
}

const draftOf = (p: Provider): Draft => ({
  name: p.name,
  email: p.email,
  whatsappPhone: p.whatsappPhone,
  language: p.language,
  taxNumber: p.taxNumber,
  commissionPercent: percentFromBp(p.commissionBp),
  dealNotes: p.dealNotes,
  active: p.active,
});

function CommissionField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <NumberField
      label="Commission (%)"
      hint="Fetivi's share of each Order."
      value={value}
      min={0}
      max={100}
      step={0.01}
      onChange={onChange}
    />
  );
}

/** /admin/providers/new */
export function NewProviderPage() {
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [whatsappPhone, setWhatsappPhone] = useState<string | null>(null);
  const [language, setLanguage] = useState<ProviderLanguage>(PROVIDER_DEFAULTS.language);
  const [commission, setCommission] = useState<number | null>(0);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await providers.create({
        name: name ?? '',
        email: email ?? '',
        whatsappPhone,
        language,
        commissionBp: bpFromPercent(commission) ?? 0,
      });
      navigate(`/admin/providers/${created.id}`, { replace: true });
    });
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/providers">Providers</Link>
      </nav>
      <div className="page-head">
        <h1>Add provider</h1>
      </div>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label="Name"
              value={name}
              maxLength={LIMITS.name}
              required
              onChange={setName}
            />
            <TextField
              label="Email"
              hint="Orders are sent here."
              type="email"
              value={email}
              maxLength={254}
              required
              onChange={setEmail}
            />
            <TextField
              label="WhatsApp number"
              hint={WHATSAPP_HINT}
              type="tel"
              value={whatsappPhone}
              maxLength={LIMITS.phone}
              onChange={setWhatsappPhone}
            />
            <SelectField
              label={LANGUAGE_LABEL}
              hint={LANGUAGE_HINT}
              value={language}
              options={PROVIDER_LANGUAGES}
              labels={PROVIDER_LANGUAGE_LABELS}
              onChange={(value) => setLanguage(value ?? PROVIDER_DEFAULTS.language)}
            />
            <CommissionField value={commission} onChange={setCommission} />
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              Create provider
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

/** /admin/providers/:id: contact, deal, status and the Provider's Offers. */
export function ProviderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [offers, setOffers] = useState<OfferSummary[] | null>(null);

  /** Takes a saved Provider; only `keys` of the draft are replaced, so other sections keep edits. */
  const accept = useCallback((saved: Provider, keys: readonly (keyof Draft)[] | 'all') => {
    setProvider(saved);
    const fresh = draftOf(saved);
    if (keys === 'all') {
      setDraft(fresh);
      return;
    }
    setDraft((d) => {
      if (!d) return fresh;
      const next = { ...d };
      for (const key of keys) (next as Record<string, unknown>)[key] = fresh[key];
      return next;
    });
  }, []);

  const reloadOffers = useCallback(
    async () => setOffers((await providers.offers(id)).offers),
    [id],
  );

  useEffect(() => {
    void run(async () => {
      accept(await providers.get(id), 'all');
      await reloadOffers();
    });
  }, [id, run, accept, reloadOffers]);

  usePendingRefresh(offers ?? [], reloadOffers);

  if (!provider || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = (keys: readonly (keyof Draft)[], body: Partial<ProviderInput>) => async () =>
    accept(await providers.update(id, body), keys);

  const hasOffers = (offers?.length ?? provider.offerCount) > 0;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/providers">Providers</Link>
      </nav>
      <div className="page-head">
        <h1>{provider.name}</h1>
        {provider.active ? null : (
          <div className="record-chips">
            <span className="chip neutral">Paused</span>
          </div>
        )}
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        <OffersPanel providerId={id} offers={offers} />

        <Section
          title="Contact"
          onSave={save(['name', 'email', 'whatsappPhone', 'language', 'taxNumber'], {
            name: draft.name ?? '',
            email: draft.email ?? '',
            whatsappPhone: draft.whatsappPhone,
            language: draft.language,
            taxNumber: draft.taxNumber,
          })}
        >
          <TextField
            label="Name"
            value={draft.name}
            maxLength={LIMITS.name}
            required
            onChange={set('name')}
          />
          <TextField
            label="Email"
            hint="Orders are sent here."
            type="email"
            value={draft.email}
            maxLength={254}
            required
            onChange={set('email')}
          />
          <TextField
            label="WhatsApp number"
            hint={WHATSAPP_HINT}
            type="tel"
            value={draft.whatsappPhone}
            maxLength={LIMITS.phone}
            onChange={set('whatsappPhone')}
          />
          <SelectField
            label={LANGUAGE_LABEL}
            hint={LANGUAGE_HINT}
            value={draft.language}
            options={PROVIDER_LANGUAGES}
            labels={PROVIDER_LANGUAGE_LABELS}
            onChange={(value) => set('language')(value ?? PROVIDER_DEFAULTS.language)}
          />
          <TextField
            label="Tax number"
            hint="Needed for the platform's reporting duty."
            value={draft.taxNumber}
            maxLength={OFFER_LIMITS.taxNumber}
            onChange={set('taxNumber')}
          />
        </Section>

        <Section
          title="Deal"
          onSave={save(['commissionPercent', 'dealNotes'], {
            commissionBp: bpFromPercent(draft.commissionPercent) ?? 0,
            dealNotes: draft.dealNotes,
          })}
        >
          <CommissionField value={draft.commissionPercent} onChange={set('commissionPercent')} />
          <TextArea
            label="Deal notes"
            hint="Only you see these."
            value={draft.dealNotes}
            maxLength={OFFER_LIMITS.dealNotes}
            onChange={set('dealNotes')}
          />
        </Section>

        <Section title="Status" onSave={save(['active'], { active: draft.active })}>
          <CheckboxField label="Active" checked={draft.active} onChange={set('active')} />
          <small>Paused Providers' Offers are hidden from guests.</small>
        </Section>

        <OnlinePaymentsPanel
          subject="provider"
          status={provider}
          onLink={() => providers.stripeOnboardingLink(provider.id)}
          onRefresh={() => providers.stripeRefresh(provider.id)}
          onChange={setProvider}
        />

        <section className="panel danger-zone">
          <h2>Delete provider</h2>
          <p className="muted">
            {hasOffers
              ? "Delete this Provider's Offers first. A Provider with Offers cannot be deleted."
              : 'Deletes this Provider. This cannot be undone.'}
          </p>
          <button
            type="button"
            className="danger"
            disabled={busy || hasOffers}
            onClick={() => {
              if (window.confirm(`Delete ${provider.name}?`)) {
                void run(async () => {
                  await providers.remove(id);
                  navigate('/admin/providers', { replace: true });
                });
              }
            }}
          >
            Delete provider
          </button>
        </section>
      </div>
    </>
  );
}

function offerLine(o: OfferSummary): string {
  return [
    o.destination?.name,
    OFFER_CATEGORY_LABELS[o.category],
    AVAILABILITY_MODE_SHORT[o.availabilityMode],
    formatPrice(o.priceMinor, o.currency, o.priceUnit),
  ]
    .filter(Boolean)
    .join(' · ');
}

function OffersPanel({
  providerId,
  offers,
}: {
  providerId: string;
  offers: OfferSummary[] | null;
}) {
  return (
    <section className="panel" aria-labelledby="offers-heading">
      <div className="page-head">
        <h2 id="offers-heading">Offers</h2>
        <Link className="button primary" to={`/admin/providers/${providerId}/offers/new`}>
          <Plus aria-hidden="true" weight="bold" />
          Add offer
        </Link>
      </div>
      {offers === null ? <p className="muted">Loading…</p> : null}
      {offers?.length === 0 ? <p className="muted">No Offers yet.</p> : null}
      {offers && offers.length > 0 ? (
        <ul className="rows">
          {offers.map((o) => (
            <li key={o.id}>
              <Link to={`/admin/offers/${o.id}`} className="row-link record-row">
                <span className="block-text record-text">
                  <strong>{o.title}</strong>
                  <span className="muted">{offerLine(o)}</span>
                </span>
                <span className="record-chips">
                  {o.active ? null : <span className="chip neutral">Paused</span>}
                  <TranslationChip status={o.translation.status} />
                </span>
                <CaretRight className="record-caret" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
