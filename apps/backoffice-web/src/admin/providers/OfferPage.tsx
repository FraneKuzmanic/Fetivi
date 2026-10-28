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
import {
  ADAPTER_KIND_LABELS,
  AVAILABILITY_MODE_LABELS,
  AVAILABILITY_MODE_SHORT,
  CONTACT_FIELDS_LABELS,
  OFFER_CATEGORY_LABELS,
  ORDER_KIND_LABELS,
  PAYMENT_MODE_LABELS,
  PRICE_UNIT_LABELS,
} from '../../forms/labels';
import { type PageSection, SectionLayout } from '../../host/SectionLayout';
import { TranslationChip } from '../../host/translations/TranslationChip';
import { usePendingRefresh } from '../../host/translations/usePendingRefresh';
import { useConfirm } from '../../shell/ConfirmDialog';
import { MoreActions } from '../../shell/MoreActions';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';
import { centsFromEuros, eurosFromCents } from './money';
import { OfferTranslations } from './OfferTranslations';
import { SlotsPanel } from './SlotsPanel';

const TRANSLATED_HINT = 'Markdown. Translated into the seven guest languages on save.';
const REQUEST_PRICE_HINT = 'Optional for requests: the Provider names the price.';
const REQUEST_MODE_HINT = 'Requests always wait for the Provider.';

/** "Free cancellation until 24 h before the start, then no refund." */
export function refundLine(hours: number | null, percent: number | null): string {
  const after =
    !percent || percent === 0
      ? 'no refund'
      : percent === 100
        ? 'a full refund'
        : `${percent} % refunded`;
  if (!hours) return percent === 100 ? 'Always a full refund.' : `No free cancellation; ${after}.`;
  return `Free cancellation until ${hours} h before the start, then ${after}.`;
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
  return (
    <div className="field-row">
      <SelectField
        label="Booking system"
        value={adapterKind}
        options={ADAPTER_KINDS}
        labels={ADAPTER_KIND_LABELS}
        emptyLabel="Choose…"
        required
        onChange={onAdapter}
      />
      <TextField
        label="Product reference"
        hint="The Offer's id in that system."
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

  usePageTitle('Add offer');

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/providers">Providers</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/admin/providers/${id}`}>{providerName ?? 'Provider'}</Link>
      </nav>
      {destinations?.length === 0 ? (
        <p className="muted">
          Add a destination in the <Link to="/admin/catalog">Catalog</Link> first.
        </p>
      ) : null}
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <SelectField
              label="Destination"
              hint="Guests staying there can order this Offer. It cannot be changed later."
              value={destinationId}
              options={destinationIds}
              labels={destinationLabels}
              onChange={setDestinationId}
            />
            <TextField
              label="Title"
              value={title}
              maxLength={LIMITS.title}
              required
              onChange={setTitle}
            />
            <TextArea
              label="Description"
              hint={TRANSLATED_HINT}
              value={description}
              maxLength={LIMITS.blockBody}
              rows={5}
              required
              monospace
              onChange={setDescription}
            />
            <TextArea
              label="Cancellation policy"
              hint="What guests read. The refund rules are set on the next page."
              value={policy}
              maxLength={LIMITS.blockBody}
              rows={3}
              required
              onChange={setPolicy}
            />
            <div className="field-row">
              <SelectField
                label="Category"
                value={category}
                options={OFFER_CATEGORIES}
                labels={OFFER_CATEGORY_LABELS}
                onChange={(c) => c && setCategory(c)}
              />
              <SelectField
                label="Order kind"
                value={orderKind}
                options={ORDER_KINDS}
                labels={ORDER_KIND_LABELS}
                onChange={(k) => k && setOrderKind(k)}
              />
            </div>
            <SelectField
              label="Availability"
              hint={isRequest ? REQUEST_MODE_HINT : undefined}
              value={effectiveMode}
              options={isRequest ? (['on_request'] as const) : AVAILABILITY_MODES}
              labels={AVAILABILITY_MODE_LABELS}
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
              label="Payment"
              value={paymentMode}
              options={PAYMENT_MODES}
              labels={PAYMENT_MODE_LABELS}
              onChange={(p) => p && setPaymentMode(p)}
            />
            <div className="field-row">
              <NumberField
                label="Price (€)"
                hint={isRequest ? REQUEST_PRICE_HINT : undefined}
                value={price}
                min={0}
                max={OFFER_LIMITS.priceMinorMax / 100}
                step={0.01}
                onChange={setPrice}
              />
              <SelectField
                label="Price unit"
                value={priceUnit}
                options={PRICE_UNITS}
                labels={PRICE_UNIT_LABELS}
                onChange={(u) => u && setPriceUnit(u)}
              />
            </div>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          <div className="actions">
            <button type="submit" className="primary" disabled={busy || !destinations?.length}>
              Create offer
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
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
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
        title: `Pause ${offer.title}?`,
        body: 'Guests stop seeing it until you resume it. Orders already placed go on.',
        action: 'Pause offer',
      });
      if (!yes) return;
    }
    void run(async () => accept(await providers.updateOffer(id, { active }), ['active']));
  }

  async function remove() {
    if (!offer) return;
    const yes = await confirm({
      title: `Delete ${offer.title}?`,
      body: 'Its time slots and translations go with it. This cannot be undone.',
      action: 'Delete offer',
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
    { id: 'text', label: 'Text', icon: TextAlignLeft },
    { id: 'type', label: 'Kind and place', icon: Tag },
    { id: 'price', label: 'Price and payment', icon: CurrencyEur },
    { id: 'availability', label: 'Availability', icon: CalendarCheck },
    ...(offer.availabilityMode === 'allotment'
      ? [{ id: 'slots', label: 'Time slots', icon: Clock }]
      : []),
    { id: 'cancellation', label: 'Cancellation', icon: ArrowUDownLeft },
    { id: 'guest', label: 'Guest details', icon: IdentificationCard },
    { id: 'translations', label: 'Translations', icon: Translate },
  ];

  const renderSection = (section: string) => {
    switch (section) {
      case 'type':
        return (
          <Section
            title="Classification"
            onSave={save(
              ['category', 'orderKind', 'placeId', ...AVAILABILITY_KEYS],
              classificationBody(),
            )}
          >
            <div className="field-row">
              <SelectField
                label="Category"
                value={draft.category}
                options={OFFER_CATEGORIES}
                labels={OFFER_CATEGORY_LABELS}
                onChange={(c) => c && set('category')(c)}
              />
              <SelectField
                label="Order kind"
                hint={isRequest ? REQUEST_MODE_HINT : undefined}
                value={draft.orderKind}
                options={ORDER_KINDS}
                labels={ORDER_KIND_LABELS}
                onChange={(k) => k && set('orderKind')(k)}
              />
            </div>
            <SelectField
              label="Linked place"
              hint={`A catalog place in ${offer.destination?.name ?? 'the destination'}, for recommendations.`}
              value={draft.placeId}
              options={placeIds}
              labels={placeLabels}
              emptyLabel="None"
              onChange={set('placeId')}
            />
          </Section>
        );
      case 'price':
        return (
          <Section
            title="Price and payment"
            onSave={save(['priceEuros', 'currency', 'priceUnit', 'paymentMode'], {
              priceMinor: centsFromEuros(draft.priceEuros),
              currency: draft.currency,
              priceUnit: draft.priceUnit,
              paymentMode: draft.paymentMode,
            })}
          >
            <div className="field-row">
              <NumberField
                label="Price (€)"
                hint={isRequest ? REQUEST_PRICE_HINT : undefined}
                value={draft.priceEuros}
                min={0}
                max={OFFER_LIMITS.priceMinorMax / 100}
                step={0.01}
                onChange={set('priceEuros')}
              />
              <TextField
                label="Currency"
                value={draft.currency}
                maxLength={3}
                required
                onChange={(v) => set('currency')((v ?? '').toUpperCase())}
              />
              <SelectField
                label="Unit"
                value={draft.priceUnit}
                options={PRICE_UNITS}
                labels={PRICE_UNIT_LABELS}
                onChange={(u) => u && set('priceUnit')(u)}
              />
            </div>
            <SelectField
              label="Payment"
              hint={
                draft.paymentMode === 'online'
                  ? "Needs the Provider's online payment setup (coming with online payments)."
                  : undefined
              }
              value={draft.paymentMode}
              options={PAYMENT_MODES}
              labels={PAYMENT_MODE_LABELS}
              onChange={(p) => p && set('paymentMode')(p)}
            />
          </Section>
        );
      case 'availability':
        return (
          <Section
            title="Availability"
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
              label="Mode"
              hint={offer.orderKind === 'request' ? REQUEST_MODE_HINT : undefined}
              value={draft.availabilityMode}
              options={
                offer.orderKind === 'request' ? (['on_request'] as const) : AVAILABILITY_MODES
              }
              labels={AVAILABILITY_MODE_LABELS}
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
                  label="Response window (minutes)"
                  value={draft.responseWindowMinutes}
                  min={1}
                  max={windowMax}
                  onChange={set('responseWindowMinutes')}
                />
                <div className="field-row">
                  <TimeField
                    label="Counted from"
                    value={draft.responseHoursFrom}
                    onChange={set('responseHoursFrom')}
                  />
                  <TimeField
                    label="Until"
                    value={draft.responseHoursTo}
                    onChange={set('responseHoursTo')}
                  />
                </div>
                <small>
                  In {offer.timezone}. Always under 4 days: with these hours, at most {windowMax}{' '}
                  minutes.
                </small>
              </>
            ) : null}
          </Section>
        );
      case 'cancellation':
        return (
          <Section
            title="Cancellation rules"
            description="What is applied when a guest cancels. Keep the policy text above in line with it."
            onSave={save(['freeCancelHoursBefore', 'refundPercentAfter'], {
              freeCancelHoursBefore: draft.freeCancelHoursBefore ?? 0,
              refundPercentAfter: draft.refundPercentAfter ?? 0,
            })}
          >
            <div className="field-row">
              <NumberField
                label="Free until (hours before start)"
                value={draft.freeCancelHoursBefore}
                min={0}
                max={OFFER_LIMITS.freeCancelHoursMax}
                onChange={set('freeCancelHoursBefore')}
              />
              <NumberField
                label="Refund after that (%)"
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
            title="Guest details for the Provider"
            onSave={save(['contactFields'], { contactFields: draft.contactFields })}
          >
            <SelectField
              label="The Provider receives"
              hint="The guest's email is always required; it is not sent to the Provider."
              value={draft.contactFields}
              options={CONTACT_FIELDS}
              labels={CONTACT_FIELDS_LABELS}
              onChange={(c) => c && set('contactFields')(c)}
            />
          </Section>
        );
      case 'slots':
        return (
          <Section title="Time slots">
            <SlotsPanel offerId={offer.id} timezone={offer.timezone} client={providers} />
          </Section>
        );
      case 'translations':
        return (
          <Section title="Translations">
            <OfferTranslations offer={offer} client={providers} onChanged={reload} />
          </Section>
        );
      default:
        return (
          <Section
            title="Text"
            description="Saving a change translates it again into the seven guest languages. The policy text is what guests read before ordering."
            onSave={save(['title', 'description', 'cancellationPolicy'], {
              title: draft.title,
              description: draft.description,
              cancellationPolicy: draft.cancellationPolicy,
            })}
          >
            <TextField
              label="Title"
              value={draft.title}
              maxLength={LIMITS.title}
              required
              onChange={(v) => set('title')(v ?? '')}
            />
            <TextArea
              label="Description"
              hint="Markdown."
              value={draft.description}
              maxLength={LIMITS.blockBody}
              rows={6}
              required
              monospace
              onChange={(v) => set('description')(v ?? '')}
            />
            <TextArea
              label="Cancellation policy"
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
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/admin/providers">Providers</Link>
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
              <span className="chip ok">Active</span>
            ) : (
              <span className="chip neutral">Paused</span>
            )}
            <TranslationChip status={offer.translation.status} />
          </div>
          <p className="muted">
            {[
              offer.destination?.name,
              OFFER_CATEGORY_LABELS[offer.category],
              AVAILABILITY_MODE_SHORT[offer.availabilityMode],
              PAYMENT_MODE_LABELS[offer.paymentMode],
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <MoreActions
          label={`More actions for ${offer.title}`}
          items={[
            offer.active
              ? {
                  label: 'Pause offer',
                  icon: <Pause aria-hidden="true" />,
                  onSelect: () => void setActive(false),
                }
              : {
                  label: 'Resume offer',
                  icon: <Play aria-hidden="true" />,
                  onSelect: () => void setActive(true),
                },
            {
              label: 'Delete offer',
              icon: <Trash aria-hidden="true" />,
              danger: true,
              onSelect: () => void remove(),
            },
          ]}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}

      <SectionLayout sections={sections} label="Offer sections" render={renderSection} />
    </>
  );
}
