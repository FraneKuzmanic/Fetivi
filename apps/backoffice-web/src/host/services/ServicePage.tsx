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
import { Link, useNavigate, useParams } from 'react-router';
import { centsFromEuros, eurosFromCents } from '../../admin/providers/money';
import { refundLine } from '../../admin/providers/OfferPage';
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
import {
  CONTACT_FIELDS_LABELS,
  OFFER_CATEGORY_LABELS,
  ORDER_KIND_LABELS,
  PRICE_UNIT_LABELS,
} from '../../forms/labels';
import { useAction } from '../../useAction';
import { TranslationChip } from '../translations/TranslationChip';
import { usePendingRefresh } from '../translations/usePendingRefresh';
import {
  HOST_AVAILABILITY_LABELS,
  HOST_AVAILABILITY_MODES,
  HOST_AVAILABILITY_SHORT,
  HOST_PAYMENT_LABELS,
  type HostAvailabilityMode,
} from './labels';

const TRANSLATED_HINT = 'Markdown. Translated into the seven guest languages on save.';
const REQUEST_PRICE_HINT = 'Optional for requests: you name the price when you accept.';
const REQUEST_MODE_HINT = 'Requests always wait for your answer.';
const ONLINE_HINT = 'Guests can pay online once your Stripe account is active (on Services).';

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
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link to="/services">Services</Link>
    </nav>
  );
}

/** /services/new: the required fields, then the full editor. */
export function NewServicePage() {
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
  const cardsActive = useCardsActive();
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [policy, setPolicy] = useState<string | null>(null);
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
        cancellationPolicy: policy ?? '',
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

  return (
    <>
      <Crumbs />
      <div className="page-head">
        <h1>Add a service</h1>
      </div>
      <section className="panel narrow">
        <form onSubmit={submit}>
          <div className="fields">
            <TextField
              label="Title"
              hint="What guests see, such as “Airport transfer” or “Home-made olive oil”."
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
              options={isRequest ? (['on_request'] as const) : HOST_AVAILABILITY_MODES}
              labels={HOST_AVAILABILITY_LABELS}
              onChange={(m) => m && setMode(m)}
            />
            <SelectField
              label="Payment"
              hint={paymentMode === 'online' && cardsActive === false ? ONLINE_HINT : undefined}
              value={paymentMode}
              options={PAYMENT_MODES}
              labels={HOST_PAYMENT_LABELS}
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
            <button type="submit" className="primary" disabled={busy}>
              Create service
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
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { busy, error, run } = useAction();
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

  if (!offer || !draft) {
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
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
        <h1>{offer.title}</h1>
        <div className="record-chips">
          <span className="chip neutral">{OFFER_CATEGORY_LABELS[offer.category]}</span>
          <span className="chip neutral">
            {HOST_AVAILABILITY_SHORT[hostMode(offer.availabilityMode)]}
          </span>
          <TranslationChip status={offer.translation.status} />
          {offer.active ? null : <span className="chip neutral">Off</span>}
        </div>
      </div>
      <p className="muted">
        {ORDER_KIND_LABELS[offer.orderKind]}. {HOST_PAYMENT_LABELS[offer.paymentMode]}. Orders reach
        your <Link to="/inbox">inbox</Link>.
      </p>
      {error ? <p role="alert">{error}</p> : null}

      <div className="editor">
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

        <Section
          title="Classification"
          onSave={save(['category', 'orderKind', ...AVAILABILITY_KEYS], classificationBody())}
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
        </Section>

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
            hint={draft.paymentMode === 'online' && cardsActive === false ? ONLINE_HINT : undefined}
            value={draft.paymentMode}
            options={PAYMENT_MODES}
            labels={HOST_PAYMENT_LABELS}
            onChange={(p) => p && set('paymentMode')(p)}
          />
        </Section>

        <Section
          title="Availability"
          onSave={save(AVAILABILITY_KEYS, {
            availabilityMode: draft.availabilityMode,
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
              offer.orderKind === 'request' ? (['on_request'] as const) : HOST_AVAILABILITY_MODES
            }
            labels={HOST_AVAILABILITY_LABELS}
            onChange={(m) => m && set('availabilityMode')(m)}
          />
          {draft.availabilityMode === 'on_request' ? (
            <>
              <NumberField
                label="Time to answer (minutes)"
                hint="Counted only between the hours below. A missed answer goes to the Fetivi team."
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

        {offer.availabilityMode === 'allotment' ? (
          <Section title="Times and seats">
            <SlotsPanel offerId={offer.id} timezone={offer.timezone} client={host} />
          </Section>
        ) : null}

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

        <Section
          title="Guest details you receive"
          onSave={save(['contactFields'], { contactFields: draft.contactFields })}
        >
          <SelectField
            label="You receive"
            hint="Shown with each order in your inbox. The guest's email stays with Fetivi."
            value={draft.contactFields}
            options={CONTACT_FIELDS}
            labels={CONTACT_FIELDS_LABELS}
            onChange={(c) => c && set('contactFields')(c)}
          />
        </Section>

        <Section title="Status" onSave={save(['active'], { active: draft.active })}>
          <CheckboxField label="On" checked={draft.active} onChange={set('active')} />
          <small>Services that are off are hidden from guests. Existing orders stay.</small>
        </Section>

        <Section title="Translations">
          <OfferTranslations
            offer={offer}
            client={translationsClient}
            onChanged={reload}
            noun="service"
          />
        </Section>

        <section className="panel danger-zone">
          <h2>Delete service</h2>
          <p className="muted">
            Deletes the service with its times and translations. A service with orders can only be
            turned off.
          </p>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete ${offer.title}? This cannot be undone.`)) {
                void run(async () => {
                  await host.deleteOffer(id);
                  navigate('/services', { replace: true });
                });
              }
            }}
          >
            Delete service
          </button>
        </section>
      </div>
    </>
  );
}
