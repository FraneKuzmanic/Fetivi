import { GUEST_NOTIFICATION_KINDS, noticeInboxData, weatherToolResult } from '@fetivi/domain';
import { sampleWeatherReport } from '@fetivi/domain/testing';
import { describe, expect, it } from 'vitest';
import {
  availabilityPicker,
  choiceCard,
  componentPart,
  type ElicitationPayload,
  elicitationPayload,
  followUpChips,
  hostMessageSent,
  inboxItem,
  type OrderSummaryPayload,
  type PlaceCardPayload,
  placeCarousel,
  receiptCard,
  weatherCard,
} from '.';

const PLACE: PlaceCardPayload = {
  id: 'a1b2',
  kind: 'place',
  category: 'restaurant',
  title: 'Konoba Fetivi',
  summary: 'Grilled fish by the harbour.',
  location: { lat: 43.51, lng: 16.25 },
  distanceKm: 0.4,
  travelMinutes: null,
  image: null,
  verifiedAt: '2026-05-01T00:00:00.000Z',
  staleness: { status: 'fresh' },
};

describe('follow-up-chips', () => {
  it('takes one to four short replies', () => {
    expect(followUpChips.safeParse({ replies: ['Show me on a map'] }).success).toBe(true);
    expect(followUpChips.safeParse({ replies: ['a', 'b', 'c', 'd'] }).success).toBe(true);
  });

  it('refuses none, five, a long one or an extra key', () => {
    for (const bad of [
      { replies: [] },
      { replies: ['a', 'b', 'c', 'd', 'e'] },
      { replies: ['x'.repeat(61)] },
      { replies: ['  '] },
      { replies: ['a'], extra: true },
    ]) {
      expect(followUpChips.safeParse(bad).success).toBe(false);
    }
  });
});

describe('choice-card', () => {
  it('defaults to a single choice', () => {
    const parsed = choiceCard.parse({ question: 'Lunch or dinner?', options: ['Lunch', 'Dinner'] });
    expect(parsed.multiple).toBe(false);
  });

  it('refuses one option, seven options and duplicates', () => {
    const q = 'Which?';
    for (const options of [['a'], ['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['a', 'a']]) {
      expect(choiceCard.safeParse({ question: q, options }).success).toBe(false);
    }
  });
});

describe('place-carousel', () => {
  it('takes places, with an optional host pick, and keeps extra fields harmless', () => {
    expect(placeCarousel.safeParse({ places: [PLACE] }).success).toBe(true);
    expect(
      placeCarousel.safeParse({ places: [{ ...PLACE, hostPick: { note: null }, phone: '1' }] })
        .success,
    ).toBe(true);
  });

  it('refuses no places, a place without a title and an unknown staleness', () => {
    const { title: _title, ...untitled } = PLACE;
    for (const bad of [
      { places: [] },
      { places: [untitled] },
      { places: [{ ...PLACE, staleness: { status: 'old' } }] },
    ]) {
      expect(placeCarousel.safeParse(bad).success).toBe(false);
    }
  });
});

describe('componentPart', () => {
  it('validates the payload for its name', () => {
    expect(
      componentPart.safeParse({ name: 'follow-up-chips', payload: { replies: ['Yes'] } }).success,
    ).toBe(true);
    expect(
      componentPart.safeParse({ name: 'place-carousel', payload: { replies: ['Yes'] } }).success,
    ).toBe(false);
  });

  it('refuses an unknown name', () => {
    expect(componentPart.safeParse({ name: 'weather', payload: {} }).success).toBe(false);
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
};

const ELICITATION: ElicitationPayload = {
  toolCallId: 'call-1',
  toolName: 'create_order',
  key: 'confirm',
  message: 'Book Blue Lagoon boat trip?',
  requestedSchema: {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email', description: 'Email' },
      name: { type: 'string', description: 'Name' },
    },
    required: ['email', 'name'],
  },
  requestState: 'opaque.state',
  hostMessage: null,
  draft: {
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
    contactFields: 'name',
  },
};

describe('availability-picker', () => {
  const day = { offerId: 'o-1', date: '2026-10-22', quantity: 2 };
  it('takes one to 24 starts, with or without a time', () => {
    const starts = [
      { slotId: 's-1', startsAtLocal: '2026-10-22T09:00', remaining: 8 },
      { slotId: null, startsAtLocal: null, remaining: null },
    ];
    expect(availabilityPicker.safeParse({ ...day, starts }).success).toBe(true);
    expect(
      componentPart.safeParse({ name: 'availability-picker', payload: { ...day, starts } }).success,
    ).toBe(true);
  });

  it('refuses an empty day or more than 24 starts', () => {
    const start = { slotId: 's', startsAtLocal: null, remaining: 1 };
    expect(availabilityPicker.safeParse({ ...day, starts: [] }).success).toBe(false);
    expect(
      availabilityPicker.safeParse({ ...day, starts: Array.from({ length: 25 }, () => start) })
        .success,
    ).toBe(false);
  });
});

describe('receipt-card', () => {
  it('takes an Order with both statuses and keeps extra fields harmless', () => {
    expect(receiptCard.safeParse({ order: { ...ORDER, extra: 1 } }).success).toBe(true);
    expect(
      componentPart.safeParse({ name: 'receipt-card', payload: { order: ORDER } }).success,
    ).toBe(true);
  });

  it('refuses an unknown status', () => {
    expect(receiptCard.safeParse({ order: { ...ORDER, status: 'booked' } }).success).toBe(false);
    expect(receiptCard.safeParse({ order: { ...ORDER, paymentStatus: 'paid' } }).success).toBe(
      false,
    );
  });
});

describe('elicitation', () => {
  it('takes the server form, the draft and the state', () => {
    expect(elicitationPayload.safeParse(ELICITATION).success).toBe(true);
    const { hostMessage: _, ...withoutHost } = ELICITATION;
    expect(elicitationPayload.parse(withoutHost).hostMessage).toBeNull();
  });

  it('takes a host message draft instead of an order draft, never both or neither', () => {
    const hostMessage = {
      pendingId: 'p-2',
      messageId: 'm-1',
      text: 'The shower has no hot water.',
      reason: 'problem',
      urgency: 'urgent',
      language: 'de',
    };
    const card = { ...ELICITATION, toolName: 'send_host_message', draft: null, hostMessage };
    expect(elicitationPayload.safeParse(card).success).toBe(true);
    expect(elicitationPayload.safeParse({ ...ELICITATION, draft: null }).success).toBe(false);
    expect(elicitationPayload.safeParse({ ...ELICITATION, hostMessage }).success).toBe(false);
    for (const bad of [
      { ...hostMessage, text: '' },
      { ...hostMessage, text: 'x'.repeat(1001) },
      { ...hostMessage, reason: 'local_question' },
      { ...hostMessage, urgency: 'asap' },
    ]) {
      expect(elicitationPayload.safeParse({ ...card, hostMessage: bad }).success).toBe(false);
    }
  });

  it('refuses a missing state, a non-object schema or a broken draft', () => {
    for (const bad of [
      { ...ELICITATION, requestState: '' },
      { ...ELICITATION, requestedSchema: { type: 'string', properties: {} } },
      { ...ELICITATION, draft: { ...ELICITATION.draft, paymentMode: 'cash' } },
    ]) {
      expect(elicitationPayload.safeParse(bad).success).toBe(false);
    }
  });
});

describe('host-message-sent', () => {
  const message = {
    id: 'm-1',
    text: 'No hot water',
    urgency: 'normal',
    sentAt: '2026-10-22T10:00:00Z',
  };
  it('takes the sent message', () => {
    expect(hostMessageSent.safeParse({ message }).success).toBe(true);
    expect(
      componentPart.safeParse({ name: 'host-message-sent', payload: { message } }).success,
    ).toBe(true);
  });

  it('refuses an unknown urgency', () => {
    expect(hostMessageSent.safeParse({ message: { ...message, urgency: 'asap' } }).success).toBe(
      false,
    );
  });
});

describe('inbox item', () => {
  it('takes a host reply with or without its original', () => {
    const reply = {
      kind: 'host-reply',
      handoffId: 'm-1',
      text: 'A plumber comes at 16:00.',
      original: 'Vodoinstalater dolazi u 16:00.',
      repliedAt: '2026-10-22T11:00:00Z',
    };
    expect(inboxItem.safeParse(reply).success).toBe(true);
    expect(inboxItem.safeParse({ ...reply, original: null }).success).toBe(true);
    expect(inboxItem.safeParse({ ...reply, kind: 'promo' }).success).toBe(false);
  });

  it('takes a notice and fills the missing facts with null', () => {
    const parsed = inboxItem.parse({
      kind: 'notice',
      notification: 'order_confirmed',
      orderId: 'o-1',
      offerTitle: 'Kayak tour',
      date: '2026-07-14',
      at: '2026-07-10T08:00:00Z',
    });
    expect(parsed).toMatchObject({ startTime: null, reviewPlatform: null, reviewUrl: null });
    expect(
      inboxItem.safeParse({
        kind: 'notice',
        notification: 'checkout_reminder',
        reviewPlatform: 'airbnb',
        reviewUrl: 'https://www.airbnb.com/trips',
        at: '2026-07-10T08:00:00Z',
      }).success,
    ).toBe(true);
    expect(
      inboxItem.safeParse({ kind: 'notice', notification: 'promo', at: '2026-07-10T08:00:00Z' })
        .success,
    ).toBe(false);
  });

  it('parses every notice the domain writes', () => {
    const now = new Date('2026-07-10T08:00:00Z');
    for (const kind of GUEST_NOTIFICATION_KINDS) {
      const data = noticeInboxData(
        {
          key: 'k',
          kind,
          spaceId: 's',
          language: 'en',
          conversationId: 'c',
          spaceOpen: true,
          email: 'guest@example.test',
          orderId: 'o-1',
          facts: {
            offerTitle: 'Kayak tour',
            date: '2026-07-14',
            startTime: '09:30',
            checkoutTime: '10:00',
            reviewPlatform: 'airbnb',
            safety: null,
            tip: null,
          },
        },
        now,
      );
      expect(inboxItem.parse(data)).toEqual(data);
      expect(JSON.stringify(data)).not.toContain('guest@example.test');
    }
  });

  it('takes the facts of a weather warning and a ferry notice, and refuses a foreign link', () => {
    const affected = {
      title: 'Bol day trip',
      date: '2026-10-15',
      startTime: '08:00',
      orderId: null,
      lines: ['9603'],
    };
    const warning = {
      source: 'DHMZ',
      level: 'yellow',
      type: 'wind',
      event: 'Yellow wind warning',
      description: 'Bura.',
      area: 'Middle Dalmatia region',
      onset: '2026-10-22T14:00:00.000Z',
      expires: '2026-10-22T21:59:59.000Z',
      timezone: 'Europe/Zagreb',
      advisory: affected,
    };
    const notice = {
      source: 'Jadrolinija',
      bulletinId: 'urn:uuid:81',
      title: 'Linije u prekidu, 15.10.2026',
      url: 'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
      timezone: 'Europe/Zagreb',
      affected,
    };
    const base = { kind: 'notice', at: '2026-10-14T16:00:00Z' };
    for (const [notification, safety] of [
      ['weather_warning', warning],
      ['ferry_disruption', notice],
    ] as const) {
      expect(inboxItem.parse({ ...base, notification, safety })).toMatchObject({ safety });
    }
    expect(
      inboxItem.safeParse({
        ...base,
        notification: 'ferry_disruption',
        safety: { ...notice, url: 'not a url' },
      }).success,
    ).toBe(false);
    expect(
      inboxItem.safeParse({
        ...base,
        notification: 'ferry_disruption',
        safety: { ...notice, affected: { ...affected, lines: ['2026'] } },
      }).success,
    ).toBe(false);
  });
});

describe('daily tip notice', () => {
  const tip = {
    rule: 'event',
    date: '2027-07-11',
    recordId: 'r1',
    kind: 'event',
    title: 'Trogir Summer of Culture',
    startsAt: '2027-07-01T20:00',
    venueName: 'Kamerlengo Fortress',
    distanceKm: 0.4,
  };
  const base = { kind: 'notice', notification: 'daily_tip', at: '2027-07-10T15:00:00Z' };

  it('takes the tip facts, and defaults them to null', () => {
    expect(inboxItem.parse({ ...base, tip })).toMatchObject({ tip });
    expect(inboxItem.parse(base)).toMatchObject({ tip: null });
  });

  it('refuses an unknown rule or record kind', () => {
    expect(inboxItem.safeParse({ ...base, tip: { ...tip, rule: 'promo' } }).success).toBe(false);
    expect(inboxItem.safeParse({ ...base, tip: { ...tip, kind: 'offer' } }).success).toBe(false);
  });
});

describe('weather', () => {
  const place = { lat: 43.52, lng: 16.25, timezone: 'Europe/Zagreb' };
  const result = weatherToolResult(
    sampleWeatherReport('2027-07-15'),
    place,
    '2027-07-15',
    new Date('2027-07-15T08:00:00Z'),
  );

  it('parses a get_weather result, dropping the fields the card does not show', () => {
    const parsed = weatherCard.parse(result);
    expect(parsed.days).toHaveLength(3);
    expect(parsed.days?.[0]).not.toHaveProperty('symbolCode');
    expect(parsed.credits.map((c) => c.source)).toEqual(['DHMZ', 'MET Norway']);
    expect(componentPart.safeParse({ name: 'weather', payload: result }).success).toBe(true);
  });

  it('keeps unknown parts as null', () => {
    const parsed = weatherCard.parse({
      ...result,
      days: null,
      sea: null,
      uv: null,
      warnings: null,
    });
    expect(parsed).toMatchObject({ days: null, sea: null, uv: null, warnings: null });
  });

  it('refuses a card without credits or with an unknown sky', () => {
    expect(weatherCard.safeParse({ ...result, credits: [] }).success).toBe(false);
    const days = [{ ...result.days?.[0], sky: 'sunny' }];
    expect(weatherCard.safeParse({ ...result, days }).success).toBe(false);
  });
});
