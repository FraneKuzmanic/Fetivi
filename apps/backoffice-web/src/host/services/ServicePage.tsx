import {
  CONTACT_FIELDS,
  maxResponseWindowMinutes,
  OFFER_CATEGORIES,
  OFFER_DEFAULTS,
  OFFER_LIMITS,
  type OfferCategory,
  ORDER_KINDS,
  type OrderKind,
  PAYMENT_MODES,
  type PaymentMode,
  PRICE_UNITS,
  type PriceUnit,
} from '@fetivi/domain/offer-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { centsFromEuros, eurosFromCents } from '../../admin/providers/money';
import { OfferTranslations } from '../../admin/providers/OfferTranslations';
import { SlotsPanel } from '../../admin/providers/SlotsPanel';
import { type HostOfferPatch, host, type Offer, type OfferTranslationsClient } from '../../api';
import {
  CheckboxField,
  NumberField,
  Section,
  SelectField,
  TextArea,
  TextField,
  TimeField,
} from '../../forms/fields';
import { useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { TranslationChip } from '../translations/TranslationChip';
import { usePendingRefresh } from '../translations/usePendingRefresh';
import {
  type CancellationRules,
  CancellationRulesField,
  policyFromRules,
} from './CancellationRules';
import { HOST_AVAILABILITY_MODES, type HostAvailabilityMode } from './labels';

const translationsClient: OfferTranslationsClient = {
  translations: host.offerTranslations,
  retryTranslation: host.retryOfferTranslation,
};

/** Own services are never live, but the shared Offer type allows it. */
const hostMode = (mode: Offer['availabilityMode']): HostAvailabilityMode =>
  mode === 'allotment' ? 'allotment' : 'on_request';

/** Whether the host's card payments are active, for the pay-online hint. */
function useCardsActive(): boolean | null {
  const [active, setActive] = useState<boolean | null>(null);
  useEffect(() => {
    host.payments().then(
      (p) => setActive(p.stripeCardPayments === 'active'),
      () => setActive(null),
    );
  }, []);
  return active;
}

function Crumbs() {
  const { t } = useTranslation(['host', 'common']);
  return (
    <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
      <Link to="/services">{t('services.title')}</Link>
    </nav>
  );
}

/** /services/new: the required fields, then the full editor. */
export function NewServicePage() {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const cardsActive = useCardsActive();
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [rules, setRules] = useState<CancellationRules>({
    freeCancelHoursBefore: OFFER_DEFAULTS.freeCancelHoursBefore,
    refundPercentAfter: OFFER_DEFAULTS.refundPercentAfter,
  });
  // The policy text follows the choice until the host writes their own.
  const [policy, setPolicy] = useState<string | null>(null);
  const policyText = policy ?? policyFromRules(rules);
  const [category, setCategory] = useState<OfferCategory>('transfer');
  const [orderKind, setOrderKind] = useState<OrderKind>('booking');
  const [mode, setMode] = useState<HostAvailabilityMode>('on_request');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('direct');
  const [price, setPrice] = useState<number | null>(null);
  const [priceUnit, setPriceUnit] = useState<PriceUnit>(OFFER_DEFAULTS.priceUnit);

  const isRequest = orderKind === 'request';
  const effectiveMode: HostAvailabilityMode = isRequest ? 'on_request' : mode;

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await host.createOffer({
        title: title ?? '',
        description: description ?? '',
        cancellationPolicy: policyText,
        freeCancelHoursBefore: rules.freeCancelHoursBefore ?? 0,
        refundPercentAfter: rules.refundPercentAfter ?? 0,
        category,
        orderKind,
        availabilityMode: effectiveMode,
        paymentMode,
        priceMinor: centsFromEuros(price),
        priceUnit,
      });
      navigate(`/services/${created.id}`, { replace: true });
    });
  }

  usePageTitle(t('services.addTitle'));

  return (
    <>
      <Crumbs />
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label={t('services.serviceTitle')}
              hint={t('services.titleHint')}
              value={title}
              maxLength={LIMITS.title}
              required
              onChange={setTitle}
            />
            <TextArea
              label={t('services.description')}
              hint={t('services.translatedHint')}
              value={description}
              maxLength={LIMITS.blockBody}
              rows={5}
              required
              onChange={setDescription}
            />
            <CancellationRulesField value={rules} onChange={setRules} />
            <TextArea
              label={t('services.policy')}
              hint={t('services.policyHint')}
              value={policyText}
              maxLength={LIMITS.blockBody}
              rows={3}
              required
              onChange={(v) => setPolicy(v ?? '')}
            />
            <div className="field-row">
              <SelectField
                label={t('services.category')}
                value={category}
                options={OFFER_CATEGORIES}
                labels={labels.offerCategory}
                onChange={(c) => c && setCategory(c)}
              />
              <SelectField
                label={t('services.orderKind')}
                value={orderKind}
                options={ORDER_KINDS}
                labels={labels.orderKind}
                onChange={(k) => k && setOrderKind(k)}
              />
            </div>
            <SelectField
              label={t('services.availability')}
              hint={isRequest ? t('services.requestModeHint') : undefined}
              value={effectiveMode}
              options={isRequest ? (['on_request'] as const) : HOST_AVAILABILITY_MODES}
              labels={labels.hostAvailability}
              onChange={(m) => m && setMode(m)}
            />
            <SelectField
              label={t('services.payment')}
              hint={
                paymentMode === 'online' && cardsActive === false
                  ? t('services.onlineHint')
                  : undefined
              }
              value={paymentMode}
              options={PAYMENT_MODES}
              labels={labels.hostPayment}
              onChange={(p) => p && setPaymentMode(p)}
            />
            <div className="field-row">
              <NumberField
                label={t('services.price')}
                hint={isRequest ? t('services.requestPriceHint') : undefined}
                value={price}
                min={0}
                max={OFFER_LIMITS.priceMinorMax / 100}
                step={0.01}
                onChange={setPrice}
              />
              <SelectField
                label={t('services.priceUnit')}
                value={priceUnit}
                options={PRICE_UNITS}
                labels={labels.priceUnit}
                onChange={(u) => u && setPriceUnit(u)}
              />
            </div>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {t('services.create')}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

type Draft = Pick<
  Offer,
  | 'title'
  | 'description'
  | 'cancellationPolicy'
  | 'category'
  | 'orderKind'
  | 'currency'
  | 'priceUnit'
  | 'paymentMode'
  | 'contactFields'
  | 'active'
> & {
  availabilityMode: HostAvailabilityMode;
  priceEuros: number | null;
  responseWindowMinutes: number | null;
  responseHoursFrom: string | null;
  responseHoursTo: string | null;
  freeCancelHoursBefore: number | null;
  refundPercentAfter: number | null;
};

const draftOf = (o: Offer): Draft => ({
  title: o.title,
  description: o.description,
  cancellationPolicy: o.cancellationPolicy,
  category: o.category,
  orderKind: o.orderKind,
  priceEuros: eurosFromCents(o.priceMinor),
  currency: o.currency,
  priceUnit: o.priceUnit,
  paymentMode: o.paymentMode,
  availabilityMode: hostMode(o.availabilityMode),
  responseWindowMinutes: o.responseWindowMinutes,
  responseHoursFrom: o.responseHoursFrom,
  responseHoursTo: o.responseHoursTo,
  freeCancelHoursBefore: o.freeCancelHoursBefore,
  refundPercentAfter: o.refundPercentAfter,
  contactFields: o.contactFields,
  active: o.active,
});

const AVAILABILITY_KEYS = [
  'availabilityMode',
  'responseWindowMinutes',
  'responseHoursFrom',
  'responseHoursTo',
] as const;

/** /services/:id: the admin Offer editor's sections, minus destination, place and live (38). */
export function ServicePage() {
  const { t } = useTranslation(['host', 'common']);
  const labels = useLabels();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const cardsActive = useCardsActive();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  /** Takes a saved Offer; only `keys` of the draft are replaced, so other sections keep edits. */
  const accept = useCallback((saved: Offer, keys: readonly (keyof Draft)[] | 'all') => {
    setOffer(saved);
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

  useEffect(() => {
    void run(async () => accept(await host.offer(id), 'all'));
  }, [id, run, accept]);

  // The chips and the translations panel follow the job; drafts are left alone.
  usePendingRefresh(offer ? [offer] : [], async () => setOffer(await host.offer(id)));

  usePageTitle(offer?.title);

  if (!offer || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  }

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = (keys: readonly (keyof Draft)[], body: HostOfferPatch) => async () =>
    accept(await host.updateOffer(id, body), keys);

  const reload = async () => setOffer(await host.offer(id));

  const isRequest = draft.orderKind === 'request';
  const windowMax = maxResponseWindowMinutes(
    draft.responseHoursFrom ?? '00:00',
    draft.responseHoursTo ?? '23:59',
  );

  // A request always waits for the host, so the Classification save moves it to on request.
  const classificationBody = (): HostOfferPatch => ({
    category: draft.category,
    orderKind: draft.orderKind,
    ...(isRequest && offer.availabilityMode !== 'on_request'
      ? { availabilityMode: 'on_request' }
      : {}),
  });

  return (
    <>
      <Crumbs />
      <div className="page-head">
        <div className="record-chips">
          <span className="chip neutral">{labels.offerCategory[offer.category]}</span>
          <span className="chip neutral">
            {labels.hostAvailabilityShort[hostMode(offer.availabilityMode)]}
          </span>
          <TranslationChip status={offer.translation.status} />
          {offer.active ? null : <span className="chip neutral">{t('services.off')}</span>}
        </div>
      </div>
      <p className="muted">
        <Trans
          t={t}
          i18nKey="services.summary"
          values={{
            kind: labels.orderKind[offer.orderKind],
            payment: labels.hostPayment[offer.paymentMode],
          }}
          components={{ anchor: <Link to="/inbox" /> }}
        />
      </p>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
        <Section
          title={t('services.text')}
          description={t('services.textHint')}
          onSave={save(['title', 'description', 'cancellationPolicy'], {
            title: draft.title,
            description: draft.description,
            cancellationPolicy: draft.cancellationPolicy,
          })}
        >
          <TextField
            label={t('services.serviceTitle')}
            value={draft.title}
            maxLength={LIMITS.title}
            required
            onChange={(v) => set('title')(v ?? '')}
          />
          <TextArea
            label={t('services.description')}
            value={draft.description}
            maxLength={LIMITS.blockBody}
            rows={6}
            required
            onChange={(v) => set('description')(v ?? '')}
          />
          <TextArea
            label={t('services.policy')}
            hint={t('services.policyEditHint')}
            value={draft.cancellationPolicy}
            maxLength={LIMITS.blockBody}
            rows={3}
            required
            onChange={(v) => set('cancellationPolicy')(v ?? '')}
          />
        </Section>

        <Section
          title={t('services.classification')}
          onSave={save(['category', 'orderKind', ...AVAILABILITY_KEYS], classificationBody())}
        >
          <div className="field-row">
            <SelectField
              label={t('services.category')}
              value={draft.category}
              options={OFFER_CATEGORIES}
              labels={labels.offerCategory}
              onChange={(c) => c && set('category')(c)}
            />
            <SelectField
              label={t('services.orderKind')}
              hint={isRequest ? t('services.requestModeHint') : undefined}
              value={draft.orderKind}
              options={ORDER_KINDS}
              labels={labels.orderKind}
              onChange={(k) => k && set('orderKind')(k)}
            />
          </div>
        </Section>

        <Section
          title={t('services.priceAndPayment')}
          onSave={save(['priceEuros', 'currency', 'priceUnit', 'paymentMode'], {
            priceMinor: centsFromEuros(draft.priceEuros),
            currency: draft.currency,
            priceUnit: draft.priceUnit,
            paymentMode: draft.paymentMode,
          })}
        >
          <div className="field-row">
            <NumberField
              label={t('services.price')}
              hint={isRequest ? t('services.requestPriceHint') : undefined}
              value={draft.priceEuros}
              min={0}
              max={OFFER_LIMITS.priceMinorMax / 100}
              step={0.01}
              onChange={set('priceEuros')}
            />
            <TextField
              label={t('services.currency')}
              value={draft.currency}
              maxLength={3}
              required
              onChange={(v) => set('currency')((v ?? '').toUpperCase())}
            />
            <SelectField
              label={t('services.unit')}
              value={draft.priceUnit}
              options={PRICE_UNITS}
              labels={labels.priceUnit}
              onChange={(u) => u && set('priceUnit')(u)}
            />
          </div>
          <SelectField
            label={t('services.payment')}
            hint={
              draft.paymentMode === 'online' && cardsActive === false
                ? t('services.onlineHint')
                : undefined
            }
            value={draft.paymentMode}
            options={PAYMENT_MODES}
            labels={labels.hostPayment}
            onChange={(p) => p && set('paymentMode')(p)}
          />
        </Section>

        <Section
          title={t('services.availability')}
          onSave={save(AVAILABILITY_KEYS, {
            availabilityMode: draft.availabilityMode,
            responseWindowMinutes: draft.responseWindowMinutes ?? 0,
            responseHoursFrom: draft.responseHoursFrom ?? '',
            responseHoursTo: draft.responseHoursTo ?? '',
          })}
        >
          <SelectField
            label={t('services.mode')}
            hint={offer.orderKind === 'request' ? t('services.requestModeHint') : undefined}
            value={draft.availabilityMode}
            options={
              offer.orderKind === 'request' ? (['on_request'] as const) : HOST_AVAILABILITY_MODES
            }
            labels={labels.hostAvailability}
            onChange={(m) => m && set('availabilityMode')(m)}
          />
          {draft.availabilityMode === 'on_request' ? (
            <>
              <NumberField
                label={t('services.answerTime')}
                hint={t('services.answerTimeHint')}
                value={draft.responseWindowMinutes}
                min={1}
                max={windowMax}
                onChange={set('responseWindowMinutes')}
              />
              <div className="field-row">
                <TimeField
                  label={t('services.countedFrom')}
                  value={draft.responseHoursFrom}
                  onChange={set('responseHoursFrom')}
                />
                <TimeField
                  label={t('services.until')}
                  value={draft.responseHoursTo}
                  onChange={set('responseHoursTo')}
                />
              </div>
              <small>
                {t('services.windowHint', { timezone: offer.timezone, count: windowMax })}
              </small>
            </>
          ) : null}
        </Section>

        {offer.availabilityMode === 'allotment' ? (
          <Section title={t('services.timesAndSeats')}>
            <SlotsPanel offerId={offer.id} timezone={offer.timezone} client={host} />
          </Section>
        ) : null}

        <Section
          title={t('services.rules')}
          description={t('services.rulesHint')}
          onSave={save(['freeCancelHoursBefore', 'refundPercentAfter'], {
            freeCancelHoursBefore: draft.freeCancelHoursBefore ?? 0,
            refundPercentAfter: draft.refundPercentAfter ?? 0,
          })}
        >
          <CancellationRulesField
            value={{
              freeCancelHoursBefore: draft.freeCancelHoursBefore,
              refundPercentAfter: draft.refundPercentAfter,
            }}
            onChange={(rules) => setDraft((d) => (d ? { ...d, ...rules } : d))}
          />
        </Section>

        <Section
          title={t('services.guestDetails')}
          onSave={save(['contactFields'], { contactFields: draft.contactFields })}
        >
          <SelectField
            label={t('services.youReceive')}
            hint={t('services.youReceiveHint')}
            value={draft.contactFields}
            options={CONTACT_FIELDS}
            labels={labels.contactFields}
            onChange={(c) => c && set('contactFields')(c)}
          />
        </Section>

        <Section title={t('services.status')} onSave={save(['active'], { active: draft.active })}>
          <CheckboxField label={t('services.on')} checked={draft.active} onChange={set('active')} />
          <small>{t('services.offHint')}</small>
        </Section>

        <Section title={t('services.translations')}>
          <OfferTranslations
            offer={offer}
            client={translationsClient}
            onChanged={reload}
            noun="service"
          />
        </Section>

        <section className="panel danger-zone">
          <h2>{t('services.delete')}</h2>
          <p className="muted">{t('services.deleteBody')}</p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (
                await confirm({
                  title: t('services.deleteTitle', { title: offer.title }),
                  body: t('services.deleteAskBody'),
                  action: t('services.delete'),
                  danger: true,
                })
              ) {
                void run(async () => {
                  await host.deleteOffer(id);
                  navigate('/services', { replace: true });
                });
              }
            }}
          >
            {t('services.delete')}
          </button>
        </section>
      </div>
    </>
  );
}
