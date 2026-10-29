import { describe, expect, it } from 'vitest';
import type {
  AffectedItem,
  DisruptionAlertFacts,
  WarningAlertFacts,
} from '../../alerts/vocabulary';
import { GUEST_LANGUAGES } from '../../property/vocabulary';
import type { DailyTipFacts } from '../../tips/vocabulary';
import { composeGuestEmail, composeGuestPush, type GuestNoticeFacts } from './compose';
import { GUEST_NOTIFICATION_KINDS } from './vocabulary';

const ORIGIN = 'https://guest.fetivi.test';
const ORDER: GuestNoticeFacts = {
  offerTitle: 'Kayak tour',
  date: '2026-07-14',
  startTime: '09:30',
  checkoutTime: null,
  reviewPlatform: null,
  safety: null,
  tip: null,
  freeCancellationEnded: false,
};
const STAY: GuestNoticeFacts = {
  offerTitle: null,
  date: null,
  startTime: null,
  checkoutTime: '10:00',
  reviewPlatform: null,
  safety: null,
  tip: null,
  freeCancellationEnded: false,
};

const ZONE = 'Europe/Zagreb';
const BOL: AffectedItem = {
  title: 'Bol day trip',
  date: '2026-10-22',
  startTime: '08:00',
  orderId: null,
  lines: ['9603'],
};
const WARNING: WarningAlertFacts = {
  source: 'DHMZ',
  level: 'orange',
  type: 'wind',
  event: 'Orange wind warning',
  description: 'Strong bura with gusts over 100 km/h',
  area: 'Middle Dalmatia region',
  onset: '2026-10-22T14:00:00.000Z',
  expires: '2026-10-22T21:59:59.000Z',
  timezone: ZONE,
  advisory: null,
};
const NOTICE: DisruptionAlertFacts = {
  source: 'Jadrolinija',
  bulletinId: 'urn:uuid:81',
  title: 'Linije u prekidu, 15.10.2026',
  url: 'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
  timezone: ZONE,
  affected: { ...BOL, date: '2026-10-15' },
};
/** The facts as the loader builds them: the item's title, date and time beside the safety facts. */
const safetyFacts = (safety: WarningAlertFacts | DisruptionAlertFacts): GuestNoticeFacts => {
  const item = safety.source === 'DHMZ' ? safety.advisory : safety.affected;
  return {
    ...STAY,
    checkoutTime: null,
    offerTitle: item?.title ?? null,
    date: item?.date ?? null,
    startTime: item?.startTime ?? null,
    safety,
  };
};

describe('composeGuestEmail', () => {
  it('fills the Order facts and links to My trip', () => {
    const { subject, text } = composeGuestEmail('order_confirmed', ORDER, 'en', ORIGIN);
    expect(subject).toBe('Confirmed: Kayak tour, Tue 14 Jul at 09:30');
    expect(text).toContain('Kayak tour on Tue 14 Jul at 09:30 is confirmed.');
    expect(text).toContain(`Open Fetivi: ${ORIGIN}/trip`);
  });

  it('says a request accepted after its free window is no longer free to cancel', () => {
    const late = composeGuestEmail(
      'order_confirmed',
      { ...ORDER, freeCancellationEnded: true },
      'en',
      ORIGIN,
    ).text;
    expect(late).toContain('so cancelling it is no longer free.');
    expect(late).not.toMatch(/refund/i);
    expect(composeGuestEmail('order_confirmed', ORDER, 'en', ORIGIN).text).not.toContain(
      'no longer free',
    );
    // Only the confirmation carries it.
    expect(
      composeGuestEmail('order_reminder', { ...ORDER, freeCancellationEnded: true }, 'en', ORIGIN)
        .text,
    ).not.toContain('no longer free');
  });

  it('leaves the time out when the Offer has none', () => {
    const { subject } = composeGuestEmail(
      'order_reminder',
      { ...ORDER, startTime: null },
      'hr',
      ORIGIN,
    );
    expect(subject).toBe('Sutra: Kayak tour');
    const { text } = composeGuestEmail(
      'order_reminder',
      { ...ORDER, startTime: null },
      'en',
      ORIGIN,
    );
    expect(text).toContain('tomorrow, Tue 14 Jul.');
  });

  it('links the arrival notice to the Guide without any codes', () => {
    const { text } = composeGuestEmail('arrival_details', STAY, 'en', ORIGIN);
    expect(text).toContain(`${ORIGIN}/guide`);
  });

  it('adds the neutral review line only when the platform is known', () => {
    const without = composeGuestEmail('checkout_reminder', STAY, 'en', ORIGIN).text;
    expect(without).toContain('Please leave by 10:00.');
    expect(without).not.toContain('review');
    const withAirbnb = composeGuestEmail(
      'checkout_reminder',
      { ...STAY, reviewPlatform: 'airbnb' },
      'en',
      ORIGIN,
    ).text;
    expect(withAirbnb).toContain('you can leave a review on Airbnb.');
    expect(withAirbnb).toContain('https://www.airbnb.com/trips');
    expect(
      composeGuestEmail('checkout_reminder', { ...STAY, reviewPlatform: 'booking' }, 'de', ORIGIN)
        .text,
    ).toContain('https://secure.booking.com/myreservations.html');
  });

  it("quotes DHMZ's warning with its times in the property zone and credits DHMZ", () => {
    const { subject, text } = composeGuestEmail(
      'weather_warning',
      safetyFacts(WARNING),
      'en',
      ORIGIN,
    );
    expect(subject).toBe('Weather warning from DHMZ (orange)');
    expect(text).toContain(
      'DHMZ, the Croatian weather service, has issued a weather warning (orange) for Middle Dalmatia region, Thu 22 Oct 16:00 – Thu 22 Oct 23:59:',
    );
    expect(text).toContain('"Orange wind warning. Strong bura with gusts over 100 km/h"');
    expect(text).toContain('Source: DHMZ, https://meteo.hr');
    expect(text).not.toContain('Sea conditions');
    expect(text).toContain(`${ORIGIN}/chat`);
  });

  it('adds the sailing advisory with the operator link to a wind warning on a ferry day', () => {
    const facts = safetyFacts({ ...WARNING, advisory: BOL });
    const en = composeGuestEmail('weather_warning', facts, 'en', ORIGIN).text;
    expect(en).toContain(
      'Sea conditions may disrupt sailings on line 9603 (Bol day trip, Thu 22 Oct at 08:00). Check with Jadrolinija before you go: https://www.jadrolinija.hr/hr/obavijesti/stanje-u-prometu/',
    );
    const hr = composeGuestEmail('weather_warning', facts, 'hr', ORIGIN).text;
    expect(hr).toContain('DHMZ');
    expect(hr).toContain('na liniji 9603');
    const bura = composeGuestEmail(
      'weather_warning',
      safetyFacts({ ...WARNING, advisory: { ...BOL, lines: ['bura-line'] } }),
      'en',
      ORIGIN,
    ).text;
    expect(bura).toContain('on line Trogir – Slatine – Split');
    expect(bura).toContain('Check with Bura Line before you go: https://www.buraline.com/infos');
  });

  it("words a ferry notice as Jadrolinija's, never as Fetivi's own cancellation", () => {
    for (const lang of ['en', 'hr'] as const) {
      const { subject, text } = composeGuestEmail(
        'ferry_disruption',
        safetyFacts(NOTICE),
        lang,
        ORIGIN,
      );
      expect(subject).toContain('9603');
      expect(text).toContain('Jadrolinij');
      expect(text).toContain('Linije u prekidu, 15.10.2026');
      expect(text).toContain(NOTICE.url);
      expect(text).toContain(`${ORIGIN}/trip`);
    }
    const en = composeGuestEmail('ferry_disruption', safetyFacts(NOTICE), 'en', ORIGIN);
    expect(en.text).toContain(`Jadrolinija's notice says: "Linije u prekidu, 15.10.2026"`);
    expect(en.text).toContain('It may affect Bol day trip on Thu 15 Oct at 08:00 (line 9603).');
    expect(`${en.subject}${en.text}`).not.toMatch(/cancelled|suspended/i);
    expect(en.text).not.toContain('provider cancels');
  });

  it('says the booking stands unless the Provider cancels it, for an Order', () => {
    const facts = safetyFacts({ ...NOTICE, affected: { ...NOTICE.affected, orderId: 'o1' } });
    const { text } = composeGuestEmail('ferry_disruption', facts, 'en', ORIGIN);
    expect(text).toContain('Your booking stays as it is unless the provider cancels it.');
    expect(text).not.toMatch(/cancelled|suspended/i);
  });

  it('never leaves a placeholder unfilled', () => {
    for (const kind of GUEST_NOTIFICATION_KINDS) {
      for (const lang of ['en', 'hr', 'de', 'it', 'pl', 'hu', 'fr'] as const) {
        const { subject, text } = composeGuestEmail(
          kind,
          { ...ORDER, ...STAY, offerTitle: 'X', date: '2026-07-14', reviewPlatform: 'booking' },
          lang,
          ORIGIN,
        );
        expect(`${subject}${text}`).not.toContain('{{');
      }
    }
  });

  it('fills every safety placeholder in every language', () => {
    const warning = safetyFacts({ ...WARNING, advisory: BOL });
    const notice = safetyFacts({ ...NOTICE, affected: { ...NOTICE.affected, orderId: 'o1' } });
    for (const lang of ['en', 'hr', 'de', 'it', 'pl', 'hu', 'fr'] as const) {
      for (const [kind, facts] of [
        ['weather_warning', warning],
        ['ferry_disruption', notice],
      ] as const) {
        const { subject, text } = composeGuestEmail(kind, facts, lang, ORIGIN);
        const push = composeGuestPush(kind, facts, lang);
        const all = `${subject}${text}${push.title}${push.body}`;
        expect(all).not.toContain('{{');
        expect(all).toContain(kind === 'weather_warning' ? 'DHMZ' : 'Jadrolin');
        expect(text).toContain('9603');
      }
    }
  });
});

describe('composeGuestEmail for a daily tip', () => {
  const LINKS = {
    page: 'https://guest.fetivi.test/unsubscribe-tips?space=s1&token=t1',
    oneClick: 'https://guest.fetivi.test/api/email/tips/unsubscribe?space=s1&token=t1',
  };
  const tip = (over: Partial<DailyTipFacts> = {}): DailyTipFacts => ({
    rule: 'rain',
    date: '2027-07-11',
    recordId: 'r1',
    kind: 'place',
    title: 'Cathedral of St Lawrence',
    startsAt: null,
    venueName: null,
    distanceKm: 1.2,
    ...over,
  });
  /** The facts as the loader builds them. */
  const tipFacts = (t: DailyTipFacts): GuestNoticeFacts => ({
    ...STAY,
    checkoutTime: null,
    offerTitle: t.title,
    date: t.date,
    startTime: t.startsAt?.slice(0, 10) === t.date ? t.startsAt.slice(11) : null,
    tip: t,
  });
  const TIPS = [
    tip(),
    tip({
      rule: 'event',
      kind: 'event',
      title: 'Klapa night',
      startsAt: '2027-07-11T20:00',
      venueName: 'Kamerlengo Fortress',
      distanceKm: 0.4,
    }),
    tip({ rule: 'gap', title: 'Pantan nature reserve', distanceKm: null }),
  ];

  it('words each rule with the title, the unsubscribe link and the one-click headers', () => {
    const rain = composeGuestEmail(
      'daily_tip',
      tipFacts(TIPS[0] as DailyTipFacts),
      'en',
      ORIGIN,
      LINKS,
    );
    expect(rain.subject).toBe('A tip for tomorrow: Cathedral of St Lawrence');
    expect(rain.text).toContain('It looks like rain tomorrow, Sun 11 Jul.');
    expect(rain.text).toContain(
      'Cathedral of St Lawrence is a good place to spend it (1.2 km away).',
    );
    expect(rain.text).toContain(`${ORIGIN}/chat`);
    expect(rain.text).toContain(`Stop these tips with one click:\n${LINKS.page}`);
    expect(rain.headers).toEqual({
      'List-Unsubscribe': `<${LINKS.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });

    const event = composeGuestEmail(
      'daily_tip',
      tipFacts(TIPS[1] as DailyTipFacts),
      'en',
      ORIGIN,
      LINKS,
    );
    expect(event.text).toContain(
      'Klapa night is on tomorrow, Sun 11 Jul at 20:00, at Kamerlengo Fortress.',
    );
    const gap = composeGuestEmail(
      'daily_tip',
      tipFacts(TIPS[2] as DailyTipFacts),
      'hr',
      ORIGIN,
      LINKS,
    );
    expect(gap.subject).toBe('Savjet za sutra: Pantan nature reserve');
    expect(gap.text).toContain(
      'Što kažete na Pantan nature reserve? Pitajte me i reći ću vam više.',
    );
    expect(gap.text).toContain(LINKS.page);
    expect(gap.headers?.['List-Unsubscribe']).toBe(`<${LINKS.oneClick}>`);
  });

  it('fills every tip placeholder in every language, with local decimals', () => {
    for (const lang of GUEST_LANGUAGES) {
      for (const t of TIPS) {
        const { subject, text } = composeGuestEmail('daily_tip', tipFacts(t), lang, ORIGIN, LINKS);
        expect(`${subject}${text}`).not.toContain('{{');
        expect(text).toContain(t.title);
        expect(text).toContain(LINKS.page);
      }
    }
    const de = composeGuestEmail(
      'daily_tip',
      tipFacts(TIPS[0] as DailyTipFacts),
      'de',
      ORIGIN,
      LINKS,
    );
    expect(de.text).toContain('1,2 km');
  });

  it('adds no headers to other kinds', () => {
    expect(
      composeGuestEmail('order_confirmed', ORDER, 'en', ORIGIN, LINKS).headers,
    ).toBeUndefined();
  });
});

describe('composeGuestPush', () => {
  it('gives a short text and a same-origin path', () => {
    expect(composeGuestPush('order_confirmed', ORDER, 'en')).toEqual({
      title: 'Confirmed',
      body: 'Kayak tour, Tue 14 Jul at 09:30',
      url: '/trip',
    });
    expect(composeGuestPush('host_reply', STAY, 'en').url).toBe('/chat');
    expect(composeGuestPush('arrival_details', STAY, 'en').url).toBe('/guide');
  });

  it('names DHMZ in every language of a weather warning push', () => {
    for (const language of GUEST_LANGUAGES) {
      expect(composeGuestPush('weather_warning', safetyFacts(WARNING), language).title).toContain(
        'DHMZ',
      );
    }
  });

  it('gives the safety kinds a short attributed text', () => {
    expect(composeGuestPush('weather_warning', safetyFacts(WARNING), 'en')).toEqual({
      title: 'DHMZ weather warning (orange)',
      body: 'Orange wind warning, Thu 22 Oct 16:00 – Thu 22 Oct 23:59',
      url: '/chat',
    });
    expect(composeGuestPush('ferry_disruption', safetyFacts(NOTICE), 'en')).toEqual({
      title: 'Jadrolinija notice: line 9603',
      body: 'Bol day trip, Thu 15 Oct at 08:00',
      url: '/trip',
    });
  });
});
