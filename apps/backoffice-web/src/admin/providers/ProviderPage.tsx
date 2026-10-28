import {
  OFFER_LIMITS,
  PROVIDER_DEFAULTS,
  PROVIDER_LANGUAGES,
  type ProviderLanguage,
} from '@fetivi/domain/offer-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import {
  AddressBook,
  CreditCard,
  Handshake,
  Pause,
  Play,
  Plus,
  Tag,
  Trash,
} from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { type OfferSummary, type Provider, type ProviderInput, providers } from '../../api';
import { NumberField, Section, SelectField, TextArea, TextField } from '../../forms/fields';
import {
  AVAILABILITY_MODE_SHORT,
  OFFER_CATEGORY_LABELS,
  PROVIDER_LANGUAGE_LABELS,
} from '../../forms/labels';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useConfirm } from '../../shell/ConfirmDialog';
import { EmptyState } from '../../shell/EmptyState';
import { MoreActions } from '../../shell/MoreActions';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { bpFromPercent, formatPrice, percentFromBp } from './money';
import { OnlinePaymentsPanel } from './OnlinePaymentsPanel';
import { percentText } from './ProvidersPage';

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

  usePageTitle('Add provider');

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/providers">Providers</Link>
      </nav>
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
  const confirm = useConfirm();
  const [blocked, setBlocked] = useState<string | null>(null);
  const { error, run } = useAction();
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

  usePageTitle(provider?.name);

  if (!provider || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  }

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = (keys: readonly (keyof Draft)[], body: Partial<ProviderInput>) => async () =>
    accept(await providers.update(id, body), keys);

  const offerCount = offers?.length ?? provider.offerCount;

  async function setActive(active: boolean) {
    if (!provider) return;
    if (!active) {
      const yes = await confirm({
        title: `Pause ${provider.name}?`,
        body: 'Guests stop seeing their offers until you resume them. Orders already placed go on.',
        action: 'Pause provider',
      });
      if (!yes) return;
    }
    void run(async () => accept(await providers.update(id, { active }), ['active']));
  }

  async function remove() {
    if (!provider) return;
    if (offerCount > 0) {
      setBlocked(
        `To delete ${provider.name}, delete their ${offerCount === 1 ? 'offer' : `${offerCount} offers`} first.`,
      );
      return;
    }
    const yes = await confirm({
      title: `Delete ${provider.name}?`,
      body: 'They have no offers left. This cannot be undone.',
      action: 'Delete provider',
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      await providers.remove(id);
      navigate('/admin/providers', { replace: true });
    });
  }

  const sections: PageSection[] = [
    { id: 'offers', label: 'Offers', icon: Tag, count: offerCount },
    { id: 'contact', label: 'Contact', icon: AddressBook },
    { id: 'deal', label: 'Deal', icon: Handshake },
    { id: 'payments', label: 'Online payments', icon: CreditCard },
  ];

  const renderSection = (section: string) => {
    switch (section) {
      case 'contact':
        return (
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
        );
      case 'deal':
        return (
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
        );
      case 'payments':
        return (
          <OnlinePaymentsPanel
            status={provider}
            onLink={() => providers.stripeOnboardingLink(provider.id)}
            onRefresh={() => providers.stripeRefresh(provider.id)}
            onChange={setProvider}
          />
        );
      default:
        return <OffersPanel providerId={id} offers={offers} />;
    }
  };

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/providers">Providers</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            {provider.active ? (
              <span className="chip ok">Active</span>
            ) : (
              <span className="chip neutral">Paused</span>
            )}
          </div>
          <p className="muted">
            {provider.email} · {percentText(provider.commissionBp)} commission
          </p>
        </div>
        <MoreActions
          label={`More actions for ${provider.name}`}
          items={[
            provider.active
              ? {
                  label: 'Pause provider',
                  icon: <Pause aria-hidden="true" />,
                  onSelect: () => void setActive(false),
                }
              : {
                  label: 'Resume provider',
                  icon: <Play aria-hidden="true" />,
                  onSelect: () => void setActive(true),
                },
            {
              label: 'Delete provider',
              icon: <Trash aria-hidden="true" />,
              danger: true,
              onSelect: () => void remove(),
            },
          ]}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {blocked ? <p role="alert">{blocked}</p> : null}

      <SectionLayout sections={sections} label="Provider sections" render={renderSection} />
    </>
  );
}

function OffersPanel({
  providerId,
  offers,
}: {
  providerId: string;
  offers: OfferSummary[] | null;
}) {
  const add = (
    <Link className="button primary" to={`/admin/providers/${providerId}/offers/new`}>
      <Plus aria-hidden="true" weight="bold" />
      Add offer
    </Link>
  );
  return (
    <section className="panel" aria-labelledby="offers-heading">
      <div className="panel-head">
        <h2 id="offers-heading">Offers</h2>
        {offers && offers.length > 0 ? add : null}
      </div>
      {offers === null ? <p className="muted">Loading…</p> : null}
      {offers?.length === 0 ? (
        <EmptyState icon={Tag} title="No offers yet" action={add}>
          An offer is something guests can book or buy from this provider, such as a boat trip.
        </EmptyState>
      ) : null}
      {offers && offers.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Offer</th>
                <th scope="col" className="wide-only">
                  Booking
                </th>
                <th scope="col" className="num wide-only">
                  Price
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id} className="linked">
                  <td>
                    <div className="cell-main">
                      <Link className="row-target" to={`/admin/offers/${o.id}`}>
                        {o.title}
                      </Link>
                      <span className="cell-sub">
                        {[o.destination?.name, OFFER_CATEGORY_LABELS[o.category]]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </td>
                  <td className="wide-only">{AVAILABILITY_MODE_SHORT[o.availabilityMode]}</td>
                  <td className="num wide-only">
                    {formatPrice(o.priceMinor, o.currency, o.priceUnit)}
                  </td>
                  <td>
                    <span className="chip-stack">
                      {o.active ? (
                        <span className="chip ok">Active</span>
                      ) : (
                        <span className="chip neutral">Paused</span>
                      )}
                      <TranslationChip status={o.translation.status} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
