import {
  ADAPTER_KINDS,
  AVAILABILITY_MODES,
  type AvailabilityMode,
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
import {
  ArrowUDownLeft,
  CalendarCheck,
  Clock,
  CurrencyEur,
  IdentificationCard,
  Pause,
  Play,
  Tag,
  TextAlignLeft,
  Translate,
  Trash,
} from '@phosphor-icons/react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { catalog, type Destination, type Offer, type OfferPatch, providers } from '../../api';
import {
  NumberField,
  Section,
  SelectField,
  TextArea,
  TextField,
  TimeField,
} from '../../forms/fields';
import { ADAPTER_KIND_LABELS } from '../../forms/labels';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { i18next } from '../../i18n';
import { useLabels } from '../../i18n/useLabels';
import { useConfirm } from '../../shell/ConfirmDialog';
import { MoreActions } from '../../shell/MoreActions';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { centsFromEuros, eurosFromCents } from './money';
import { OfferTranslations } from './OfferTranslations';
import { SlotsPanel } from './SlotsPanel';

/** "Free cancellation until 24 h before the start, then no refund." */
export function refundLine(hours: number | null, percent: number | null): string {
  const t = i18next.getFixedT(null, 'admin', 'offer');
  if (!hours) {
    if (percent === 100) return t('alwaysFull');
    return !percent ? t('noFreeNoRefund') : t('noFreePercent', { percent });
  }
  if (!percent) return t('untilNoRefund', { hours });
  return percent === 100 ? t('untilFull', { hours }) : t('untilPercent', { hours, percent });
}

/** Live mode's adapter fields; shown only for live. */
function LiveFields({
  adapterKind,
  externalProductRef,
  onAdapter,
  onRef,
}: {
  adapterKind: Offer['adapterKind'];
  externalProductRef: string | null;
  onAdapter: (value: Offer['adapterKind']) => void;
  onRef: (value: string | null) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  return (
    <div className="field-row">
      <SelectField
        label={t('offer.bookingSystem')}
        value={adapterKind}
        options={ADAPTER_KINDS}
        labels={ADAPTER_KIND_LABELS}
        emptyLabel={t('offer.choose')}
        required
        onChange={onAdapter}
      />
      <TextField
        label={t('offer.productRef')}
        hint={t('offer.productRefHint')}
        value={externalProductRef}
        maxLength={OFFER_LIMITS.externalRef}
        required
        onChange={onRef}
      />
    </div>
  );
}

/** /admin/providers/:id/offers/new: the required fields, then the full editor. */
export function NewOfferPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const [providerName, setProviderName] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Destination[] | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [policy, setPolicy] = useState<string | null>(null);
  const [category, setCategory] = useState<OfferCategory>('tour');
  const [orderKind, setOrderKind] = useState<OrderKind>('booking');
  const [mode, setMode] = useState<AvailabilityMode>('on_request');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('direct');
  const [price, setPrice] = useState<number | null>(null);
  const [priceUnit, setPriceUnit] = useState<PriceUnit>(OFFER_DEFAULTS.priceUnit);
  const [adapterKind, setAdapterKind] = useState<Offer['adapterKind']>(null);
  const [externalRef, setExternalRef] = useState<string | null>(null);

  useEffect(() => {
    void run(async () => {
      const [provider, list] = await Promise.all([providers.get(id), catalog.destinations()]);
      setProviderName(provider.name);
      setDestinations(list.destinations);
      setDestinationId((d) => d ?? list.destinations[0]?.id ?? null);
    });
  }, [id, run]);

  const isRequest = orderKind === 'request';
  const effectiveMode: AvailabilityMode = isRequest ? 'on_request' : mode;
  const live = effectiveMode === 'live';

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const created = await providers.createOffer(id, {
        destinationId: destinationId ?? '',
        title: title ?? '',
        description: description ?? '',
        cancellationPolicy: policy ?? '',
        category,
        orderKind,
        availabilityMode: effectiveMode,
        paymentMode,
        priceMinor: centsFromEuros(price),
        priceUnit,
        adapterKind: live ? adapterKind : null,
        externalProductRef: live ? externalRef : null,
      });
      navigate(`/admin/offers/${created.id}`, { replace: true });
    });
  }

  const destinationIds = destinations?.map((d) => d.id) ?? [];
  const destinationLabels = Object.fromEntries(destinations?.map((d) => [d.id, d.name]) ?? []);

  usePageTitle(t('offer.add'));

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/providers">{t('providers.title')}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/admin/providers/${id}`}>{providerName ?? t('providers.provider')}</Link>
      </nav>
      {destinations?.length === 0 ? (
        <p className="muted">
          <Trans
            t={t}
            i18nKey="offer.needDestination"
            components={{ anchor: <Link to="/admin/catalog" /> }}
          />
        </p>
      ) : null}
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <SelectField
              label={t('offer.destination')}
              hint={t('offer.destinationHint')}
              value={destinationId}
              options={destinationIds}
              labels={destinationLabels}
              onChange={setDestinationId}
            />
            <TextField
              label={t('offer.title')}
              value={title}
              maxLength={LIMITS.title}
              required
              onChange={setTitle}
            />
            <TextArea
              label={t('offer.description')}
              hint={t('offer.translatedHint')}
              value={description}
              maxLength={LIMITS.blockBody}
              rows={5}
              required
              monospace
              onChange={setDescription}
            />
            <TextArea
              label={t('offer.policy')}
              hint={t('offer.policyHint')}
              value={policy}
              maxLength={LIMITS.blockBody}
              rows={3}
              required
              onChange={setPolicy}
            />
            <div className="field-row">
              <SelectField
                label={t('offer.category')}
                value={category}
                options={OFFER_CATEGORIES}
                labels={labels.offerCategory}
                onChange={(c) => c && setCategory(c)}
              />
              <SelectField
                label={t('offer.orderKind')}
                value={orderKind}
                options={ORDER_KINDS}
                labels={labels.orderKind}
                onChange={(k) => k && setOrderKind(k)}
              />
            </div>
            <SelectField
              label={t('offer.availability')}
              hint={isRequest ? t('offer.requestModeHint') : undefined}
              value={effectiveMode}
              options={isRequest ? (['on_request'] as const) : AVAILABILITY_MODES}
              labels={labels.availabilityMode}
              onChange={(m) => m && setMode(m)}
            />
            {live ? (
              <LiveFields
                adapterKind={adapterKind}
                externalProductRef={externalRef}
                onAdapter={setAdapterKind}
                onRef={setExternalRef}
              />
            ) : null}
            <SelectField
              label={t('offer.payment')}
              value={paymentMode}
              options={PAYMENT_MODES}
              labels={labels.paymentMode}
              onChange={(p) => p && setPaymentMode(p)}
            />
            <div className="field-row">
              <NumberField
                label={t('offer.price')}
                hint={isRequest ? t('offer.requestPriceHint') : undefined}
                value={price}
                min={0}
                max={OFFER_LIMITS.priceMinorMax / 100}
                step={0.01}
                onChange={setPrice}
              />
              <SelectField
                label={t('offer.priceUnit')}
                value={priceUnit}
                options={PRICE_UNITS}
                labels={labels.priceUnit}
                onChange={(u) => u && setPriceUnit(u)}
              />
            </div>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || !destinations?.length}>
              {t('offer.create')}
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
  | 'placeId'
  | 'currency'
  | 'priceUnit'
  | 'paymentMode'
  | 'availabilityMode'
  | 'adapterKind'
  | 'externalProductRef'
  | 'contactFields'
  | 'active'
> & {
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
  placeId: o.placeId,
  priceEuros: eurosFromCents(o.priceMinor),
  currency: o.currency,
  priceUnit: o.priceUnit,
  paymentMode: o.paymentMode,
  availabilityMode: o.availabilityMode,
  adapterKind: o.adapterKind,
  externalProductRef: o.externalProductRef,
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
  'adapterKind',
  'externalProductRef',
  'responseWindowMinutes',
  'responseHoursFrom',
  'responseHoursTo',
] as const;

/** /admin/offers/:id */
export function OfferPage() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { error, run } = useAction();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [places, setPlaces] = useState<{ id: string; title: string }[]>([]);

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
    void run(async () => {
      const fresh = await providers.offer(id);
      accept(fresh, 'all');
      if (fresh.destination) {
        const { records } = await catalog.records(fresh.destination.id);
        setPlaces(records.filter((r) => r.kind === 'place'));
      }
    });
  }, [id, run, accept]);

  // The chips and the translations panel follow the job; drafts are left alone.
  usePendingRefresh(offer ? [offer] : [], async () => setOffer(await providers.offer(id)));

  usePageTitle(offer?.title);

  if (!offer || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">{t('common:loading')}</p>;
  }

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = (keys: readonly (keyof Draft)[], body: OfferPatch) => async () =>
    accept(await providers.updateOffer(id, body), keys);

  const reload = async () => setOffer(await providers.offer(id));

  const isRequest = draft.orderKind === 'request';
  const live = draft.availabilityMode === 'live';
  const windowMax = maxResponseWindowMinutes(
    draft.responseHoursFrom ?? '00:00',
    draft.responseHoursTo ?? '23:59',
  );
  const placeIds = places.map((p) => p.id);
  const placeLabels = Object.fromEntries(places.map((p) => [p.id, p.title]));
  // A linked place missing from the list (deleted meanwhile) still shows by name.
  if (offer.place && !placeIds.includes(offer.place.id)) {
    placeIds.unshift(offer.place.id);
    placeLabels[offer.place.id] = offer.place.title;
  }

  // A request always waits for the Provider, so the Classification save moves it to on request.
  const classificationBody = (): OfferPatch => ({
    category: draft.category,
    orderKind: draft.orderKind,
    placeId: draft.placeId,
    ...(isRequest && offer.availabilityMode !== 'on_request'
      ? { availabilityMode: 'on_request', adapterKind: null, externalProductRef: null }
      : {}),
  });

  async function setActive(active: boolean) {
    if (!offer) return;
    if (!active) {
      const yes = await confirm({
        title: t('offer.pauseTitle', { title: offer.title }),
        body: t('offer.pauseBody'),
        action: t('offer.pause'),
      });
      if (!yes) return;
    }
    void run(async () => accept(await providers.updateOffer(id, { active }), ['active']));
  }

  async function remove() {
    if (!offer) return;
    const yes = await confirm({
      title: t('offer.deleteTitle', { title: offer.title }),
      body: t('offer.deleteBody'),
      action: t('offer.delete'),
      danger: true,
    });
    if (!yes) return;
    void run(async () => {
      await providers.deleteOffer(id);
      navigate(offer.provider ? `/admin/providers/${offer.provider.id}` : '/admin/providers', {
        replace: true,
      });
    });
  }

  const sections: PageSection[] = [
    { id: 'text', label: t('offer.text'), icon: TextAlignLeft },
    { id: 'type', label: t('offer.kindPlace'), icon: Tag },
    { id: 'price', label: t('offer.priceAndPayment'), icon: CurrencyEur },
    { id: 'availability', label: t('offer.availability'), icon: CalendarCheck },
    ...(offer.availabilityMode === 'allotment'
      ? [{ id: 'slots', label: t('offer.slots'), icon: Clock }]
      : []),
    { id: 'cancellation', label: t('offer.cancellation'), icon: ArrowUDownLeft },
    { id: 'guest', label: t('offer.guest'), icon: IdentificationCard },
    { id: 'translations', label: t('offer.translations'), icon: Translate },
  ];

  const renderSection = (section: string) => {
    switch (section) {
      case 'type':
        return (
          <Section
            title={t('offer.classification')}
            onSave={save(
              ['category', 'orderKind', 'placeId', ...AVAILABILITY_KEYS],
              classificationBody(),
            )}
          >
            <div className="field-row">
              <SelectField
                label={t('offer.category')}
                value={draft.category}
                options={OFFER_CATEGORIES}
                labels={labels.offerCategory}
                onChange={(c) => c && set('category')(c)}
              />
              <SelectField
                label={t('offer.orderKind')}
                hint={isRequest ? t('offer.requestModeHint') : undefined}
                value={draft.orderKind}
                options={ORDER_KINDS}
                labels={labels.orderKind}
                onChange={(k) => k && set('orderKind')(k)}
              />
            </div>
            <SelectField
              label={t('offer.linkedPlace')}
              hint={t('offer.linkedPlaceHint', {
                destination: offer.destination?.name ?? t('offer.theDestination'),
              })}
              value={draft.placeId}
              options={placeIds}
              labels={placeLabels}
              emptyLabel={t('offer.none')}
              onChange={set('placeId')}
            />
          </Section>
        );
      case 'price':
        return (
          <Section
            title={t('offer.priceAndPayment')}
            onSave={save(['priceEuros', 'currency', 'priceUnit', 'paymentMode'], {
              priceMinor: centsFromEuros(draft.priceEuros),
              currency: draft.currency,
              priceUnit: draft.priceUnit,
              paymentMode: draft.paymentMode,
            })}
          >
            <div className="field-row">
              <NumberField
                label={t('offer.price')}
                hint={isRequest ? t('offer.requestPriceHint') : undefined}
                value={draft.priceEuros}
                min={0}
                max={OFFER_LIMITS.priceMinorMax / 100}
                step={0.01}
                onChange={set('priceEuros')}
              />
              <TextField
                label={t('offer.currency')}
                value={draft.currency}
                maxLength={3}
                required
                onChange={(v) => set('currency')((v ?? '').toUpperCase())}
              />
              <SelectField
                label={t('offer.unit')}
                value={draft.priceUnit}
                options={PRICE_UNITS}
                labels={labels.priceUnit}
                onChange={(u) => u && set('priceUnit')(u)}
              />
            </div>
            <SelectField
              label={t('offer.payment')}
              hint={draft.paymentMode === 'online' ? t('offer.onlineHint') : undefined}
              value={draft.paymentMode}
              options={PAYMENT_MODES}
              labels={labels.paymentMode}
              onChange={(p) => p && set('paymentMode')(p)}
            />
          </Section>
        );
      case 'availability':
        return (
          <Section
            title={t('offer.availability')}
            onSave={save(AVAILABILITY_KEYS, {
              availabilityMode: draft.availabilityMode,
              adapterKind: live ? draft.adapterKind : null,
              externalProductRef: live ? draft.externalProductRef : null,
              responseWindowMinutes: draft.responseWindowMinutes ?? 0,
              responseHoursFrom: draft.responseHoursFrom ?? '',
              responseHoursTo: draft.responseHoursTo ?? '',
            })}
          >
            <SelectField
              label={t('offer.mode')}
              hint={offer.orderKind === 'request' ? t('offer.requestModeHint') : undefined}
              value={draft.availabilityMode}
              options={
                offer.orderKind === 'request' ? (['on_request'] as const) : AVAILABILITY_MODES
              }
              labels={labels.availabilityMode}
              onChange={(m) => m && set('availabilityMode')(m)}
            />
            {live ? (
              <LiveFields
                adapterKind={draft.adapterKind}
                externalProductRef={draft.externalProductRef}
                onAdapter={set('adapterKind')}
                onRef={set('externalProductRef')}
              />
            ) : null}
            {draft.availabilityMode === 'on_request' ? (
              <>
                <NumberField
                  label={t('offer.responseWindow')}
                  value={draft.responseWindowMinutes}
                  min={1}
                  max={windowMax}
                  onChange={set('responseWindowMinutes')}
                />
                <div className="field-row">
                  <TimeField
                    label={t('offer.countedFrom')}
                    value={draft.responseHoursFrom}
                    onChange={set('responseHoursFrom')}
                  />
                  <TimeField
                    label={t('offer.until')}
                    value={draft.responseHoursTo}
                    onChange={set('responseHoursTo')}
                  />
                </div>
                <small>
                  {t('host:services.windowHint', { timezone: offer.timezone, count: windowMax })}
                </small>
              </>
            ) : null}
          </Section>
        );
      case 'cancellation':
        return (
          <Section
            title={t('offer.rules')}
            description={t('offer.rulesHint')}
            onSave={save(['freeCancelHoursBefore', 'refundPercentAfter'], {
              freeCancelHoursBefore: draft.freeCancelHoursBefore ?? 0,
              refundPercentAfter: draft.refundPercentAfter ?? 0,
            })}
          >
            <div className="field-row">
              <NumberField
                label={t('offer.freeHours')}
                value={draft.freeCancelHoursBefore}
                min={0}
                max={OFFER_LIMITS.freeCancelHoursMax}
                onChange={set('freeCancelHoursBefore')}
              />
              <NumberField
                label={t('offer.refundAfter')}
                value={draft.refundPercentAfter}
                min={0}
                max={100}
                onChange={set('refundPercentAfter')}
              />
            </div>
            <p className="muted">
              {refundLine(draft.freeCancelHoursBefore, draft.refundPercentAfter)}
            </p>
          </Section>
        );
      case 'guest':
        return (
          <Section
            title={t('offer.guestDetails')}
            onSave={save(['contactFields'], { contactFields: draft.contactFields })}
          >
            <SelectField
              label={t('offer.receives')}
              hint={t('offer.receivesHint')}
              value={draft.contactFields}
              options={CONTACT_FIELDS}
              labels={labels.contactFields}
              onChange={(c) => c && set('contactFields')(c)}
            />
          </Section>
        );
      case 'slots':
        return (
          <Section title={t('offer.slots')}>
            <SlotsPanel offerId={offer.id} timezone={offer.timezone} client={providers} />
          </Section>
        );
      case 'translations':
        return (
          <Section title={t('offer.translations')}>
            <OfferTranslations offer={offer} client={providers} onChanged={reload} />
          </Section>
        );
      default:
        return (
          <Section
            title={t('offer.text')}
            description={t('offer.textHint')}
            onSave={save(['title', 'description', 'cancellationPolicy'], {
              title: draft.title,
              description: draft.description,
              cancellationPolicy: draft.cancellationPolicy,
            })}
          >
            <TextField
              label={t('offer.title')}
              value={draft.title}
              maxLength={LIMITS.title}
              required
              onChange={(v) => set('title')(v ?? '')}
            />
            <TextArea
              label={t('offer.description')}
              hint={t('offer.markdown')}
              value={draft.description}
              maxLength={LIMITS.blockBody}
              rows={6}
              required
              monospace
              onChange={(v) => set('description')(v ?? '')}
            />
            <TextArea
              label={t('offer.policy')}
              value={draft.cancellationPolicy}
              maxLength={LIMITS.blockBody}
              rows={3}
              required
              onChange={(v) => set('cancellationPolicy')(v ?? '')}
            />
          </Section>
        );
    }
  };

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/admin/providers">{t('providers.title')}</Link>
        {offer.provider ? (
          <>
            <span aria-hidden="true">/</span>
            <Link to={`/admin/providers/${offer.provider.id}`}>{offer.provider.name}</Link>
          </>
        ) : null}
      </nav>
      <div className="page-head">
        <div className="page-title">
          <div className="title-line">
            {offer.active ? (
              <span className="chip ok">{t('providers.active')}</span>
            ) : (
              <span className="chip neutral">{t('providers.paused')}</span>
            )}
            <TranslationChip status={offer.translation.status} />
          </div>
          <p className="muted">
            {[
              offer.destination?.name,
              labels.offerCategory[offer.category],
              labels.availabilityModeShort[offer.availabilityMode],
              labels.paymentMode[offer.paymentMode],
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <MoreActions
          label={t('offer.moreActions', { title: offer.title })}
          items={[
            offer.active
              ? {
                  label: t('offer.pause'),
                  icon: <Pause aria-hidden="true" />,
                  onSelect: () => void setActive(false),
                }
              : {
                  label: t('offer.resume'),
                  icon: <Play aria-hidden="true" />,
                  onSelect: () => void setActive(true),
                },
            {
              label: t('offer.delete'),
              icon: <Trash aria-hidden="true" />,
              danger: true,
              onSelect: () => void remove(),
            },
          ]}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <SectionLayout sections={sections} label={t('offer.sections')} render={renderSection} />
    </>
  );
}
