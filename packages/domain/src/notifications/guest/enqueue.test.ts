import { describe, expect, it } from 'vitest';
import type { DisruptionAlertFacts, WarningAlertFacts } from '../../alerts/vocabulary';
import { guestNotificationKey } from './enqueue';

const SPACE = '00000000-0000-4000-8000-000000000001';
const WARNING: WarningAlertFacts = {
  source: 'DHMZ',
  level: 'yellow',
  type: 'wind',
  event: 'Yellow wind warning',
  description: 'Bura.',
  area: 'Middle Dalmatia region',
  onset: '2026-10-22T14:00:00.000Z',
  expires: '2026-10-22T21:59:59.000Z',
  timezone: 'Europe/Zagreb',
  advisory: null,
};
const NOTICE: DisruptionAlertFacts = {
  source: 'Jadrolinija',
  bulletinId: 'urn:uuid:81',
  title: 'Linije u prekidu, 15.10.2026',
  url: 'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
  timezone: 'Europe/Zagreb',
  affected: { title: 'Bol', date: '2026-10-15', startTime: null, orderId: null, lines: ['9603'] },
};

describe('guestNotificationKey for safety alerts', () => {
  it('keys a warning by type, level and times, whatever its wording, area or advisory', () => {
    const key = guestNotificationKey({ kind: 'weather_warning', spaceId: SPACE, safety: WARNING });
    expect(key).toBe(
      `space:${SPACE}:weather_warning:wind:yellow:2026-10-22T14:00:00.000Z:2026-10-22T21:59:59.000Z`,
    );
    const croatian = {
      ...WARNING,
      event: 'Žuto upozorenje za vjetar',
      area: 'Splitsko-dalmatinska',
      advisory: { ...NOTICE.affected, date: '2026-10-22' },
    };
    expect(
      guestNotificationKey({ kind: 'weather_warning', spaceId: SPACE, safety: croatian }),
    ).toBe(key);
    // An escalation is a new alert.
    expect(
      guestNotificationKey({
        kind: 'weather_warning',
        spaceId: SPACE,
        safety: { ...WARNING, level: 'orange' },
      }),
    ).not.toBe(key);
  });

  it('keys a ferry notice by its id, whatever item it names', () => {
    const key = guestNotificationKey({ kind: 'ferry_disruption', spaceId: SPACE, safety: NOTICE });
    expect(key).toBe(`space:${SPACE}:ferry_disruption:jadrolinija:urn:uuid:81`);
    const other = { ...NOTICE, affected: { ...NOTICE.affected, title: 'Hvar', orderId: 'o1' } };
    expect(guestNotificationKey({ kind: 'ferry_disruption', spaceId: SPACE, safety: other })).toBe(
      key,
    );
  });

  it('throws without the facts of the kind', () => {
    expect(() => guestNotificationKey({ kind: 'weather_warning', spaceId: SPACE })).toThrow();
    expect(() =>
      guestNotificationKey({ kind: 'ferry_disruption', spaceId: SPACE, safety: WARNING }),
    ).toThrow();
    expect(() => guestNotificationKey({ kind: 'weather_warning', safety: WARNING })).toThrow();
  });
});
