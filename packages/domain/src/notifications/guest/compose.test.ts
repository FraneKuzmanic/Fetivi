import { describe, expect, it } from 'vitest';
import { composeGuestEmail, composeGuestPush, type GuestNoticeFacts } from './compose';
import { GUEST_NOTIFICATION_KINDS } from './vocabulary';

const ORIGIN = 'https://guest.fetivi.test';
const ORDER: GuestNoticeFacts = {
  offerTitle: 'Kayak tour',
  date: '2026-07-14',
  startTime: '09:30',
  checkoutTime: null,
  reviewPlatform: null,
};
const STAY: GuestNoticeFacts = {
  offerTitle: null,
  date: null,
  startTime: null,
  checkoutTime: '10:00',
  reviewPlatform: null,
};

describe('composeGuestEmail', () => {
  it('fills the Order facts and links to My trip', () => {
    const { subject, text } = composeGuestEmail('order_confirmed', ORDER, 'en', ORIGIN);
    expect(subject).toBe('Confirmed: Kayak tour, Tue 14 Jul at 09:30');
    expect(text).toContain('Kayak tour on Tue 14 Jul at 09:30 is confirmed.');
    expect(text).toContain(`Open Fetivi: ${ORIGIN}/trip`);
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
});
