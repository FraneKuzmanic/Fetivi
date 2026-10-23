// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrderDraft, OrderSummaryPayload } from '../payloads';
import {
  AvailabilityPicker,
  type AvailabilityPickerLabels,
} from './availability-picker/AvailabilityPicker';
import {
  ConfirmationCard,
  type ConfirmationCardLabels,
} from './confirmation-card/ConfirmationCard';
import { ReceiptCard, type ReceiptLabels } from './receipt-card/ReceiptCard';

let root: Root | null = null;
let host: HTMLElement;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return host;
}

const button = (text: string) => {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};
const input = (name: string) => {
  const found = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!found) throw new Error(`no input ${name}`);
  return found;
};
/** Types like a user: React listens to the native input event. */
const type = (el: HTMLInputElement, value: string) =>
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const key = (target: Element, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
const submit = () =>
  act(() => {
    host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

const DRAFT: OrderDraft = {
  pendingId: 'p-1',
  offerId: 'o-1',
  offerTitle: 'Blue Lagoon boat trip',
  language: 'en',
  date: '2026-10-22',
  slotId: 's-1',
  startsAt: '2026-10-22T07:00:00.000Z',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  paymentMode: 'direct',
  availabilityMode: 'allotment',
  cancellationPolicy: 'Free cancellation up to 24 hours before.',
  contactFields: 'name_and_phone',
};

const CARD: ConfirmationCardLabels = {
  heading: 'Confirm your booking',
  offer: 'Trip',
  when: 'When',
  quantity: (unit) => (unit === 'person' ? 'People' : unit),
  total: 'Total',
  payment: 'Payment',
  cancellation: 'Cancellation',
  dateTime: (date, local) => (local ? `${date} at ${local.slice(11)}` : date),
  price: (minor, currency) =>
    minor === null ? 'Set by the provider' : `${minor / 100} ${currency}`,
  paymentMode: (mode) => (mode === 'direct' ? 'Pay the provider directly' : 'Online'),
  field: { email: 'Email', name: 'Name', phone: 'Phone' },
  invalid: { email: 'Enter an email.', name: 'Enter a name.', phone: 'Enter a phone number.' },
  note: 'These details go to the provider for this booking only.',
  noteOnline: 'Next you pay on a secure page; your card is charged only once confirmed.',
  confirm: 'Confirm',
  confirmOnline: 'Continue to payment',
  cancel: 'Cancel',
  sending: 'Booking…',
};

const FIELDS = [
  { name: 'email', required: true },
  { name: 'name', required: true },
  { name: 'phone', required: true },
] as const;

const card = (state: 'open' | 'sending' = 'open', onConfirm = vi.fn(), onCancel = vi.fn()) =>
  mount(
    <ConfirmationCard
      draft={DRAFT}
      fields={FIELDS}
      state={state}
      onConfirm={onConfirm}
      onCancel={onCancel}
      labels={CARD}
    />,
  );

describe('ConfirmationCard', () => {
  it('explains paying online and names the next step on the button', () => {
    mount(
      <ConfirmationCard
        draft={{ ...DRAFT, paymentMode: 'online' }}
        fields={FIELDS}
        state="open"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        labels={CARD}
      />,
    );
    expect(host.textContent).toContain(CARD.noteOnline);
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe('Continue to payment');
  });

  it('keeps the pay-direct copy', () => {
    card();
    expect(host.textContent).not.toContain(CARD.noteOnline);
    expect(host.querySelector('button[type="submit"]')?.textContent).toBe('Confirm');
  });

  it('shows every stored fact and the note', () => {
    card();
    const text = host.textContent ?? '';
    for (const fact of [
      'Blue Lagoon boat trip',
      '2026-10-22 at 09:00',
      'People2',
      '90 EUR',
      'Pay the provider directly',
      'Free cancellation up to 24 hours before.',
      'These details go to the provider for this booking only.',
    ]) {
      expect(text).toContain(fact);
    }
    const section = host.querySelector('section');
    const heading = host.querySelector('h3');
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(host.querySelector('form')?.getAttribute('aria-labelledby')).toBe(heading?.id);
    // The card never steals focus.
    expect(document.activeElement).toBe(document.body);
  });

  it('gives every input an accessible name and the right autocomplete', () => {
    card();
    for (const name of ['email', 'name', 'phone']) {
      const el = input(name);
      const label = host.querySelector(`label[for="${el.id}"]`);
      expect(label?.textContent).toBe(CARD.field[name as 'email']);
      expect(el.required).toBe(true);
    }
    expect([input('email').type, input('email').autocomplete]).toEqual(['email', 'email']);
    expect([input('phone').type, input('phone').inputMode]).toEqual(['tel', 'tel']);
  });

  it('shows an error tied to an empty email, focuses it and sends nothing', () => {
    const onConfirm = vi.fn();
    card('open', onConfirm);
    type(input('name'), 'Ana');
    type(input('phone'), '+385 91 000');
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
    const email = input('email');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const error = host.querySelector(
      `#${CSS.escape(email.getAttribute('aria-describedby') ?? '')}`,
    );
    expect(error?.textContent).toBe('Enter an email.');
    expect(document.activeElement).toBe(email);
  });

  it('sends exactly the form’s fields, trimmed, on Confirm', () => {
    const onConfirm = vi.fn();
    card('open', onConfirm);
    type(input('email'), ' guest@example.test ');
    type(input('name'), 'Ana');
    type(input('phone'), '+385 91 000');
    submit();
    expect(onConfirm).toHaveBeenCalledWith({
      email: 'guest@example.test',
      name: 'Ana',
      phone: '+385 91 000',
    });
  });

  it('starts from the given values, which still validate', () => {
    const onConfirm = vi.fn();
    mount(
      <ConfirmationCard
        draft={DRAFT}
        fields={FIELDS}
        state="open"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        labels={CARD}
        initialValues={{ email: 'guest@example.test' }}
      />,
    );
    expect(input('email').value).toBe('guest@example.test');
    type(input('email'), 'not-an-email');
    type(input('name'), 'Ana');
    type(input('phone'), '+385 91 000');
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
    type(input('email'), 'guest@example.test');
    submit();
    expect(onConfirm).toHaveBeenCalledWith({
      email: 'guest@example.test',
      name: 'Ana',
      phone: '+385 91 000',
    });
  });

  it('fills a value that arrives late without losing what was typed', () => {
    const card = (initialValues?: { email: string }) => (
      <ConfirmationCard
        draft={DRAFT}
        fields={FIELDS}
        state="open"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        labels={CARD}
        initialValues={initialValues}
      />
    );
    mount(card());
    type(input('name'), 'Ana');
    act(() => root?.render(card({ email: 'guest@example.test' })));
    expect(input('name').value).toBe('Ana');
    expect(input('email').value).toBe('guest@example.test');
  });

  it('never overwrites an email the guest typed', () => {
    const card = (initialValues?: { email: string }) => (
      <ConfirmationCard
        draft={DRAFT}
        fields={FIELDS}
        state="open"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        labels={CARD}
        initialValues={initialValues}
      />
    );
    mount(card());
    type(input('email'), 'mine@example.test');
    act(() => root?.render(card({ email: 'guest@example.test' })));
    expect(input('email').value).toBe('mine@example.test');
  });

  it('skips an empty optional field', () => {
    const onConfirm = vi.fn();
    mount(
      <ConfirmationCard
        draft={DRAFT}
        fields={[
          { name: 'email', required: true },
          { name: 'phone', required: false },
        ]}
        state="open"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        labels={CARD}
      />,
    );
    type(input('email'), 'guest@example.test');
    submit();
    expect(onConfirm).toHaveBeenCalledWith({ email: 'guest@example.test' });
  });

  it('cancels', () => {
    const onCancel = vi.fn();
    card('open', vi.fn(), onCancel);
    act(() => button('Cancel').click());
    expect(onCancel).toHaveBeenCalled();
  });

  it('while sending: everything disabled and a status line', () => {
    const onConfirm = vi.fn();
    card('sending', onConfirm);
    expect(button('Confirm').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    expect(input('email').disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Booking…');
    submit();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('says when the provider sets the price', () => {
    mount(
      <ConfirmationCard
        draft={{ ...DRAFT, priceMinor: null }}
        fields={FIELDS}
        state="open"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        labels={CARD}
      />,
    );
    expect(host.textContent).toContain('Set by the provider');
  });
});

const PICKER: AvailabilityPickerLabels = {
  heading: (date) => `Starts on ${date}`,
  time: (local) => (local ? local.slice(11) : 'Any time'),
  placesLeft: (n) => `${n} places left`,
};
const STARTS = [
  { slotId: 's-1', startsAtLocal: '2026-10-22T09:00', remaining: 8 },
  { slotId: 's-2', startsAtLocal: '2026-10-22T15:00', remaining: null },
  { slotId: null, startsAtLocal: null, remaining: 3 },
];

describe('AvailabilityPicker', () => {
  it('moves focus with arrows and picks on Enter or a tap', () => {
    const onPick = vi.fn();
    mount(
      <AvailabilityPicker
        date="2026-10-22"
        starts={STARTS}
        active
        onPick={onPick}
        labels={PICKER}
      />,
    );
    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-labelledby')).toBe(host.querySelector('h3')?.id);
    const first = button('09:00 · 8 places left');
    first.focus();
    key(first, 'ArrowDown');
    expect(document.activeElement).toBe(button('15:00'));
    expect(onPick).not.toHaveBeenCalled();
    act(() => button('Any time · 3 places left').click());
    expect(onPick).toHaveBeenCalledWith(STARTS[2]);
  });

  it('is a plain list when inactive', () => {
    mount(
      <AvailabilityPicker
        date="2026-10-22"
        starts={STARTS}
        active={false}
        onPick={vi.fn()}
        labels={PICKER}
      />,
    );
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelectorAll('li')).toHaveLength(3);
  });
});

const ORDER: OrderSummaryPayload = {
  id: 'f2b1c3d4-0000-4000-8000-000000000001',
  offerId: 'o-1',
  offerTitle: 'Blue Lagoon boat trip',
  status: 'confirmed',
  paymentStatus: 'none',
  paymentMode: 'direct',
  date: '2026-10-22',
  startsAt: '2026-10-22T07:00:00.000Z',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  createdAt: '2026-10-21T10:00:00.000Z',
  payBy: null,
  refundMinor: null,
  respondBy: null,
};

const RECEIPT: ReceiptLabels = {
  when: 'When',
  quantity: CARD.quantity,
  total: 'Total',
  status: 'Booking',
  payment: 'Payment',
  reference: 'Reference',
  dateTime: CARD.dateTime,
  price: CARD.price,
  orderStatus: (s) => (s === 'confirmed' ? 'Confirmed' : s),
  paymentStatus: (s, mode) => (s === 'none' && mode === 'direct' ? 'Pay the provider directly' : s),
  pay: 'Pay now',
  payBy: (iso) => `Complete payment by ${iso.slice(11, 16)}`,
  paying: 'Opening the secure payment page…',
};

describe('ReceiptCard', () => {
  it('shows both statuses as text, the facts and a short reference', () => {
    mount(<ReceiptCard order={ORDER} labels={RECEIPT} />);
    const text = host.textContent ?? '';
    for (const fact of [
      'Blue Lagoon boat trip',
      'Confirmed',
      'Pay the provider directly',
      '2026-10-22 at 09:00',
      'People2',
      '90 EUR',
      'F2B1C3D4',
    ]) {
      expect(text).toContain(fact);
    }
    const dots = [...host.querySelectorAll('.fv-status-dot')];
    expect(dots.map((d) => d.getAttribute('aria-hidden'))).toEqual(['true', 'true']);
    // Confirmed is done; paying the provider is still to do, so the markers differ.
    expect(dots.map((d) => d.getAttribute('data-tone'))).toEqual(['good', 'wait']);
  });

  it('offers Pay now while the checkout is open, and only with a handler', () => {
    const online = {
      ...ORDER,
      status: 'confirming' as const,
      paymentMode: 'online' as const,
      payBy: '2026-10-21T10:30:00.000Z',
    };
    const onPay = vi.fn();
    mount(<ReceiptCard order={online} labels={RECEIPT} onPay={onPay} />);
    const pay = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Pay now');
    expect(host.textContent).toContain('Complete payment by 10:30');
    act(() => pay?.click());
    expect(onPay).toHaveBeenCalledWith(ORDER.id);

    mount(<ReceiptCard order={online} labels={RECEIPT} onPay={onPay} paying />);
    expect(host.querySelector('button')?.disabled).toBe(true);
    expect(host.textContent).toContain('Opening the secure payment page…');

    mount(<ReceiptCard order={online} labels={RECEIPT} />);
    expect(host.querySelector('button')).toBeNull();
    mount(<ReceiptCard order={{ ...online, payBy: null }} labels={RECEIPT} onPay={onPay} />);
    expect(host.querySelector('button')).toBeNull();
  });

  it('shows the refund next to its status once one is decided', () => {
    const refunded = {
      ...ORDER,
      status: 'cancelled' as const,
      paymentMode: 'online' as const,
      paymentStatus: 'refund_pending' as const,
      refundMinor: 4500,
    };
    mount(<ReceiptCard order={refunded} labels={RECEIPT} />);
    expect(host.textContent).toContain('refund_pending · 45 EUR');
    mount(<ReceiptCard order={{ ...refunded, paymentStatus: 'failed' }} labels={RECEIPT} />);
    expect(host.textContent).toContain('failed · 45 EUR');
    mount(<ReceiptCard order={{ ...refunded, paymentStatus: 'captured' }} labels={RECEIPT} />);
    expect(host.textContent).not.toContain('45 EUR');
  });

  it('shows a notice line', () => {
    mount(<ReceiptCard order={ORDER} labels={RECEIPT} notice="The payment window has closed." />);
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      'The payment window has closed.',
    );
  });
});
