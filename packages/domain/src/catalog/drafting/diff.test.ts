import { describe, expect, it } from 'vitest';
import { diffRefresh, type RefreshCurrent } from './diff';

const SITE = 'https://www.svdominik.com/contact/';

const current: RefreshCurrent = {
  title: 'Konoba Trs',
  address: 'Matije Gupca 14, Trogir',
  phone: '+385 21 796 956',
  websiteUrl: 'https://www.konobatrs.com/',
  openingHours: [
    { weekday: 1, opens: '12:00:00', closes: '23:00:00', validFrom: null, validTo: null },
    { weekday: 2, opens: '12:00:00', closes: '23:00:00', validFrom: null, validTo: null },
  ],
  seasons: [{ fromMonth: 4, fromDay: 1, toMonth: 10, toDay: 31 }],
};

describe('diffRefresh', () => {
  it('finds nothing when the same facts are written differently', () => {
    expect(
      diffRefresh(current, {
        title: 'KONOBA TRŠ',
        address: 'matije gupca  14, TROGIR',
        phone: '+385 (21) 796-956',
        websiteUrl: 'https://konobatrs.com',
        openingHours: [
          { weekday: 2, opens: '12:00', closes: '23:00', validFrom: null, validTo: null },
          { weekday: 1, opens: '12:00', closes: '23:00', validFrom: null, validTo: null },
        ],
        seasons: [{ fromMonth: 4, fromDay: 1, toMonth: 10, toDay: 31 }],
        fieldSources: { title: SITE },
      }),
    ).toBeNull();
  });

  it('queues new hours with the previous hours and their source', () => {
    const hours = [{ weekday: 1, opens: '15:00', closes: '23:00', validFrom: null, validTo: null }];
    expect(
      diffRefresh(current, {
        title: 'Konoba Trs',
        openingHours: hours,
        fieldSources: { title: SITE, openingHours: SITE },
      }),
    ).toEqual({
      changes: { openingHours: hours, fieldSources: { openingHours: SITE } },
      previous: { openingHours: current.openingHours },
    });
  });

  it('does not count a field the pages do not mention', () => {
    expect(diffRefresh(current, { title: 'Konoba Trs' })).toBeNull();
  });

  it('never compares the description', () => {
    expect(diffRefresh(current, { description: 'A new text every time.' })).toBeNull();
  });

  it('queues a phone the record did not have, with no previous value', () => {
    expect(diffRefresh({ ...current, phone: null }, { phone: '+385 21 796 956' })).toEqual({
      changes: { phone: '+385 21 796 956', fieldSources: {} },
      previous: {},
    });
  });
});
