import { describe, expect, it } from 'vitest';
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
    expect(composeHostMessageEmail(facts(), ORIGIN).subject).toBe('New guest message: Apartment 1');
    const urgent = composeHostMessageEmail(facts({ urgency: 'urgent' }), ORIGIN);
    expect(urgent.subject).toBe('Urgent guest message: Apartment 1');
    expect(urgent.text).toContain('Fetivi marked it urgent.');
    expect(composeHostMessageEmail(facts(), ORIGIN).text).not.toContain('urgent');
  });

  it('links to the message and names unit, property, dates and reason', () => {
    const { text } = composeHostMessageEmail(row, ORIGIN);
    expect(text).toContain(`${ORIGIN}/inbox?message=${row.id}`);
    expect(text).toContain('Villa Mare, Apartment 1 (24 Oct 2026 – 27 Oct 2026)');
    expect(text).toContain('Reason: Problem');
    expect(text).toContain('Replies to this email do not reach the guest.');
    expect(text).not.toContain(GUEST_TEXT);
  });
});

describe('host digest email', () => {
  const first = facts({ id: 'a', unitName: 'Apartment 1', reason: 'request' });
  const second = facts({ id: 'b', unitName: 'Studio 2', reason: 'property_question' });

  it('counts singular and plural', () => {
    expect(composeHostDigestEmail([first], ORIGIN).subject).toBe('1 new guest message');
    expect(composeHostDigestEmail([first, second], ORIGIN).subject).toBe('2 new guest messages');
  });

  it('lists the messages in the given order and links to the inbox', () => {
    const { text } = composeHostDigestEmail([first, second], ORIGIN);
    expect(text.indexOf('Apartment 1')).toBeLessThan(text.indexOf('Studio 2'));
    expect(text).toContain('- Apartment 1, 24 Oct 2026 – 27 Oct 2026: Request');
    expect(text).toContain(`${ORIGIN}/inbox\n`);
    expect(text).toContain('Replies to this email do not reach the guest.');
    expect(text).not.toContain(GUEST_TEXT);
  });

  it('names the property when the messages span several', () => {
    const other = facts({ id: 'c', propertyName: 'Kuca Sunce', unitName: 'Room 3' });
    const { text } = composeHostDigestEmail([first, other], ORIGIN);
    expect(text).toContain('- Villa Mare · Apartment 1');
    expect(text).toContain('- Kuca Sunce · Room 3');
  });
});

describe('host pushes', () => {
  it('opens the message, or the inbox for a digest', () => {
    expect(composeHostMessagePush(facts({ urgency: 'urgent' }))).toEqual({
      title: 'Urgent guest message',
      body: 'Apartment 1 · Problem',
      url: `/inbox?message=${row.id}`,
    });
    const list = [facts({ id: 'a' }), facts({ id: 'b' }), facts({ id: 'c', unitName: 'Studio 2' })];
    expect(composeHostDigestPush(list)).toEqual({
      title: '3 new guest messages',
      body: 'Apartment 1, Studio 2',
      url: '/inbox',
    });
  });
});
