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
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { type OfferSummary, type Provider, type ProviderInput, providers } from '../../api';
import { NumberField, Section, SelectField, TextArea, TextField } from '../../forms/fields';
import { PROVIDER_LANGUAGE_LABELS } from '../../forms/labels';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { EmptyState } from '../../shell/EmptyState';
import { MoreActions } from '../../shell/MoreActions';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { bpFromPercent, formatPrice, percentFromBp } from './money';
import { OnlinePaymentsPanel } from './OnlinePaymentsPanel';
import { percentText } from './ProvidersPage';

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
  const { t } = useTranslation(['admin', 'common', 'host']);
  return (
    <NumberField
      label={t('provider.commission')}
      hint={t('provider.commissionHint')}
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
  const { t } = useTranslation(['admin', 'common', 'host']);
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

  usePageTitle(t('providers.add'));

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/providers">{t('providers.title')}</Link>
      </nav>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label={t('provider.name')}
              value={name}
              maxLength={LIMITS.name}
              required
              onChange={setName}
            />
            <TextField
              label={t('provider.email')}
              hint={t('provider.emailHint')}
              type="email"
              value={email}
              maxLength={254}
              required
              onChange={setEmail}
            />
            <TextField
              label={t('provider.whatsapp')}
              type="tel"
              value={whatsappPhone}
              maxLength={LIMITS.phone}
              onChange={setWhatsappPhone}
            />
            <SelectField
              label={t('provider.language')}
              hint={t('provider.languageHint')}
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
              {t('provider.create')}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

/** /admin/providers/:id: contact, deal, status and the Provider's Offers. */
export function ProviderPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
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
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
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
        title: t('provider.pauseTitle', { name: provider.name }),
        body: t('provider.pauseBody'),
        action: t('provider.pause'),
      });
      if (!yes) return;
    }
    void run(async () => accept(await providers.update(id, { active }), ['active']));
  }

  async function remove() {
    if (!provider) return;
    if (offerCount > 0) {
      setBlocked(t('provider.deleteBlocked', { name: provider.name, count: offerCount }));
      return;
    }
    const yes = await confirm({
      title: t('provider.deleteTitle', { name: provider.name }),
      body: t('provider.deleteBody'),
      action: t('provider.delete'),
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      await providers.remove(id);
      navigate('/admin/providers', { replace: true });
    });
  }

  const sections: PageSection[] = [
    { id: 'offers', label: t('provider.offers'), icon: Tag, count: offerCount },
    { id: 'contact', label: t('provider.contact'), icon: AddressBook },
    { id: 'deal', label: t('provider.deal'), icon: Handshake },
    { id: 'payments', label: t('providers.onlinePayments'), icon: CreditCard },
  ];

  const renderSection = (section: string) => {
    switch (section) {
      case 'contact':
        return (
          <Section
            title={t('provider.contact')}
            onSave={save(['name', 'email', 'whatsappPhone', 'language', 'taxNumber'], {
              name: draft.name ?? '',
              email: draft.email ?? '',
              whatsappPhone: draft.whatsappPhone,
              language: draft.language,
              taxNumber: draft.taxNumber,
            })}
          >
            <TextField
              label={t('provider.name')}
              value={draft.name}
              maxLength={LIMITS.name}
              required
              onChange={set('name')}
            />
            <TextField
              label={t('provider.email')}
              hint={t('provider.emailHint')}
              type="email"
              value={draft.email}
              maxLength={254}
              required
              onChange={set('email')}
            />
            <TextField
              label={t('provider.whatsapp')}
              type="tel"
              value={draft.whatsappPhone}
              maxLength={LIMITS.phone}
              onChange={set('whatsappPhone')}
            />
            <SelectField
              label={t('provider.language')}
              hint={t('provider.languageHint')}
              value={draft.language}
              options={PROVIDER_LANGUAGES}
              labels={PROVIDER_LANGUAGE_LABELS}
              onChange={(value) => set('language')(value ?? PROVIDER_DEFAULTS.language)}
            />
            <TextField
              label={t('provider.taxNumber')}
              hint={t('provider.taxHint')}
              value={draft.taxNumber}
              maxLength={OFFER_LIMITS.taxNumber}
              onChange={set('taxNumber')}
            />
          </Section>
        );
      case 'deal':
        return (
          <Section
            title={t('provider.deal')}
            onSave={save(['commissionPercent', 'dealNotes'], {
              commissionBp: bpFromPercent(draft.commissionPercent) ?? 0,
              dealNotes: draft.dealNotes,
            })}
          >
            <CommissionField value={draft.commissionPercent} onChange={set('commissionPercent')} />
            <TextArea
              label={t('provider.dealNotes')}
              hint={t('provider.dealNotesHint')}
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
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/providers">{t('providers.title')}</Link>
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            {provider.active ? (
              <span className="chip ok">{t('providers.active')}</span>
            ) : (
              <span className="chip neutral">{t('providers.paused')}</span>
            )}
          </div>
          <p className="muted">
            {provider.email} · {percentText(provider.commissionBp)} commission
          </p>
        </div>
        <MoreActions
          label={t('provider.moreActions', { name: provider.name })}
          items={[
            provider.active
              ? {
                  label: t('provider.pause'),
                  icon: <Pause aria-hidden="true" />,
                  onSelect: () => void setActive(false),
                }
              : {
                  label: t('provider.resume'),
                  icon: <Play aria-hidden="true" />,
                  onSelect: () => void setActive(true),
                },
            {
              label: t('provider.delete'),
              icon: <Trash aria-hidden="true" />,
              danger: true,
              onSelect: () => void remove(),
            },
          ]}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {blocked ? <p role="alert">{blocked}</p> : null}

      <SectionLayout sections={sections} label={t('provider.sections')} render={renderSection} />
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
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const add = (
    <Link className="button primary" to={`/admin/providers/${providerId}/offers/new`}>
      <Plus aria-hidden="true" weight="bold" />
      {t('provider.addOffer')}
    </Link>
  );
  return (
    <section className="panel" aria-labelledby="offers-heading">
      <div className="panel-head">
        <h2 id="offers-heading">{t('provider.offers')}</h2>
        {offers && offers.length > 0 ? add : null}
      </div>
      {offers === null ? <p className="muted">{t('common:loading')}</p> : null}
      {offers?.length === 0 ? (
        <EmptyState icon={Tag} title={t('provider.noOffers')} action={add}>
          {t('provider.noOffersBody')}
        </EmptyState>
      ) : null}
      {offers && offers.length > 0 ? (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('provider.offer')}</th>
                <th scope="col" className="wide-only">
                  {t('provider.booking')}
                </th>
                <th scope="col" className="num wide-only">
                  {t('provider.price')}
                </th>
                <th scope="col">{t('providers.status')}</th>
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
                        {[o.destination?.name, labels.offerCategory[o.category]]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  </td>
                  <td className="wide-only">{labels.availabilityModeShort[o.availabilityMode]}</td>
                  <td className="num wide-only">
                    {formatPrice(o.priceMinor, o.currency, o.priceUnit)}
                  </td>
                  <td>
                    <span className="chip-stack">
                      {o.active ? (
                        <span className="chip ok">{t('providers.active')}</span>
                      ) : (
                        <span className="chip neutral">{t('providers.paused')}</span>
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
