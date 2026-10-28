import { describe, expect, it } from 'vitest';
import { HANDOFF_REASON_LABELS } from '../../handoff/vocabulary';
import {
  composeHostDigestEmail,
  composeHostDigestPush,
  composeHostMessageEmail,
  composeHostMessagePush,
  type HostMessageFacts,
} from './compose';

const ORIGIN = 'https://host.fetivi.test';
const GUEST_TEXT = 'The hot water stopped working in the bathroom';

const facts = (over: Partial<HostMessageFacts> = {}): HostMessageFacts => ({
  id: '11111111-1111-4111-8111-111111111111',
  unitName: 'Apartment 1',
  propertyName: 'Villa Mare',
  checkIn: '2026-10-24',
  checkout: '2026-10-27',
  reason: 'problem',
  urgency: 'normal',
  ...over,
});

// The facts type has no text field, so the guest's words cannot reach the composer. This is what
// the handoff_messages row would hold; the output must never echo it.
const row = { ...facts(), text: GUEST_TEXT };

describe('host message email', () => {
  it('prefixes the subject only for urgent messages', () => {
    expect(composeHostMessageEmail(facts(), ORIGIN, 'en').subject).toBe(
      'New guest message: Apartment 1',
    );
    const urgent = composeHostMessageEmail(facts({ urgency: 'urgent' }), ORIGIN, 'en');
    expect(urgent.subject).toBe('Urgent guest message: Apartment 1');
    expect(urgent.text).toContain('Fetivi marked it urgent.');
    expect(composeHostMessageEmail(facts(), ORIGIN, 'en').text).not.toContain('urgent');
  });

  it('links to the message and names unit, property, dates and reason', () => {
    const { text } = composeHostMessageEmail(row, ORIGIN, 'en');
    expect(text).toContain(`${ORIGIN}/inbox?message=${row.id}`);
    expect(text).toContain('Villa Mare, Apartment 1 (24 Oct 2026 – 27 Oct 2026)');
    expect(text).toContain('Reason: Problem');
    expect(text).toContain('Replies to this email do not reach the guest.');
    expect(text).not.toContain(GUEST_TEXT);
  });

  it('words the reason as the Inbox does', () => {
    const { text } = composeHostMessageEmail(facts({ reason: 'guest_asked' }), ORIGIN, 'en');
    expect(text).toContain(`Reason: ${HANDOFF_REASON_LABELS.guest_asked}`);
    expect(HANDOFF_REASON_LABELS.guest_asked).toBe('Asked to contact you');
  });
});

describe('host digest email', () => {
  const first = facts({ id: 'a', unitName: 'Apartment 1', reason: 'request' });
  const second = facts({ id: 'b', unitName: 'Studio 2', reason: 'property_question' });

  it('counts singular and plural', () => {
    expect(composeHostDigestEmail([first], ORIGIN, 'en').subject).toBe('1 new guest message');
    expect(composeHostDigestEmail([first, second], ORIGIN, 'en').subject).toBe(
      '2 new guest messages',
    );
  });

  it('lists the messages in the given order and links to the inbox', () => {
    const { text } = composeHostDigestEmail([first, second], ORIGIN, 'en');
    expect(text.indexOf('Apartment 1')).toBeLessThan(text.indexOf('Studio 2'));
    expect(text).toContain('- Apartment 1, 24 Oct 2026 – 27 Oct 2026: Request');
    expect(text).toContain(`${ORIGIN}/inbox\n`);
    expect(text).toContain('Replies to this email do not reach the guest.');
    expect(text).not.toContain(GUEST_TEXT);
  });

  it('names the property when the messages span several', () => {
    const other = facts({ id: 'c', propertyName: 'Kuca Sunce', unitName: 'Room 3' });
    const { text } = composeHostDigestEmail([first, other], ORIGIN, 'en');
    expect(text).toContain('- Villa Mare · Apartment 1');
    expect(text).toContain('- Kuca Sunce · Room 3');
  });
});

describe('host pushes', () => {
  it('opens the message, or the inbox for a digest', () => {
    expect(composeHostMessagePush(facts({ urgency: 'urgent' }), 'en')).toEqual({
      title: 'Urgent guest message',
      body: 'Apartment 1 · Problem',
      url: `/inbox?message=${row.id}`,
    });
    const list = [facts({ id: 'a' }), facts({ id: 'b' }), facts({ id: 'c', unitName: 'Studio 2' })];
    expect(composeHostDigestPush(list, 'en')).toEqual({
      title: '3 new guest messages',
      body: 'Apartment 1, Studio 2',
      url: '/inbox',
    });
  });
});

describe('in Croatian', () => {
  it('writes the email, the digest and the pushes in Croatian with day-first dates', () => {
    const urgent = composeHostMessageEmail(facts({ urgency: 'urgent' }), ORIGIN, 'hr');
    expect(urgent.subject).toBe('Hitna poruka gosta: Apartment 1');
    expect(urgent.text).toContain('Villa Mare, Apartment 1 (24.10.2026. – 27.10.2026.)');
    expect(urgent.text).toContain('Razlog: Problem');
    expect(urgent.text).toContain('Odgovori na ovu e-poruku ne stižu do gosta.');

    const list = (n: number) => Array.from({ length: n }, (_, i) => facts({ id: String(i) }));
    expect(composeHostDigestEmail(list(1), ORIGIN, 'hr').subject).toBe('1 nova poruka gosta');
    expect(composeHostDigestEmail(list(3), ORIGIN, 'hr').subject).toBe('3 nove poruke gosta');
    expect(composeHostDigestEmail(list(5), ORIGIN, 'hr').subject).toBe('5 novih poruka gosta');
    expect(composeHostDigestEmail(list(3), ORIGIN, 'hr').text).toContain(
      'Čekaju vas 3 poruke gosta:',
    );
    expect(composeHostMessagePush(facts({ reason: 'request' }), 'hr').body).toBe(
      'Apartment 1 · Zahtjev',
    );
    expect(composeHostDigestPush(list(2), 'hr').title).toBe('2 nove poruke gosta');
  });
});
