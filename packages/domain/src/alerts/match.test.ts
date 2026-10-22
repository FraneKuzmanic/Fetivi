import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { recordedWeatherFetch, WEATHER_RECORDED_AT } from '../testing/weather';
import { createWeatherSource, type WeatherWarning } from '../weather/source';
import { type FerryNotice, parseJadrolinijaFeed } from './jadrolinija';
import { disruptionAlerts, warningAlerts } from './match';
import type { AlertSpace } from './spaces';
import type { AffectedItem, DisruptionAlertFacts, WarningAlertFacts } from './vocabulary';

const ZONE = 'Europe/Zagreb';
const NOW = WEATHER_RECORDED_AT; // 2026-10-22 22:28 in Zagreb
const TROGIR = { lat: 43.5167, lng: 16.2511 };

const item = (over: Partial<AffectedItem> = {}): AffectedItem => ({
  title: 'Bol day trip',
  date: '2026-10-22',
  startTime: '09:00',
  orderId: null,
  lines: ['9603'],
  ...over,
});

const space = (over: Partial<AlertSpace> = {}): AlertSpace => ({
  spaceId: '00000000-0000-4000-8000-000000000001',
  language: 'en',
  zone: ZONE,
  place: TROGIR,
  checkIn: '2026-10-20',
  closedAt: new Date('2026-10-27T10:00:00Z'),
  items: [],
  ...over,
});

let recorded: WeatherWarning[];

beforeAll(async () => {
  const fetch = recordedWeatherFetch();
  const weather = createWeatherSource({ fetch, userAgent: 'test', clock: () => NOW });
  recorded = (await weather.warnings(TROGIR, 'en', NOW)) ?? [];
});

const facts = (jobs: { safety?: unknown }[]) => jobs.map((j) => j.safety as WarningAlertFacts);

describe('warningAlerts', () => {
  it('alerts the bura until midnight and the 24 Oct thunderstorm for a Stay covering both', () => {
    const jobs = warningAlerts(recorded, space(), NOW);
    expect(jobs.map((j) => j.kind)).toEqual(['weather_warning', 'weather_warning']);
    expect(facts(jobs)).toMatchObject([
      {
        source: 'DHMZ',
        type: 'wind',
        level: 'yellow',
        area: 'Middle Dalmatia region',
        onset: '2026-10-22T14:00:00.000Z',
        expires: '2026-10-22T21:59:59.000Z',
        timezone: ZONE,
        advisory: null,
      },
      { type: 'thunderstorm', advisory: null },
    ]);
  });

  it('merges the county and marine copies of one warning', () => {
    const [bura] = recorded;
    if (!bura) throw new Error('no recorded bura');
    const county = { ...bura, area: 'Splitsko-dalmatinska' };
    expect(warningAlerts([bura, county], space(), NOW)).toHaveLength(1);
  });

  it('alerts the thunderstorm only when the Stay covers 24 Oct', () => {
    const closesBefore = space({ closedAt: new Date('2026-10-23T10:00:00Z') });
    expect(facts(warningAlerts(recorded, closesBefore, NOW)).map((f) => f.type)).toEqual(['wind']);
  });

  it('drops an expired warning, and one that ends before the Stay starts', () => {
    const expired: WeatherWarning = {
      level: 'yellow',
      type: 'wind',
      event: 'Yellow wind warning',
      description: 'Bura.',
      area: 'Istra',
      onset: '2026-10-22T04:00:00.000Z',
      expires: '2026-10-22T16:00:00.000Z',
    };
    expect(warningAlerts([expired], space(), NOW)).toEqual([]);
    const later = space({ checkIn: '2026-10-25' });
    expect(facts(warningAlerts(recorded, later, NOW)).map((f) => f.type)).toEqual([]);
  });

  it('adds the sailing advisory to a wind warning on a day with a line-dependent item', () => {
    const order = item({ title: 'Hvar boat tour', orderId: 'o1', lines: ['635'] });
    const withItems = space({ items: [item({ date: '2026-10-23' }), item(), order] });
    const [wind, storm] = facts(warningAlerts(recorded, withItems, NOW));
    // Same day and time: the Order first.
    expect(wind?.advisory).toEqual(order);
    expect(storm?.advisory).toBeNull();
  });

  it('gives no advisory when no item falls on a warning day', () => {
    const otherDay = space({ items: [item({ date: '2026-10-23' })] });
    expect(facts(warningAlerts(recorded, otherDay, NOW))[0]?.advisory).toBeNull();
  });
});

describe('disruptionAlerts', () => {
  let notice: FerryNotice;
  // Two days before the notice's day, so the 15 Oct items are still ahead.
  const BEFORE = new Date('2026-10-13T10:00:00Z');

  beforeAll(() => {
    const xml = readFileSync(
      new URL('./recorded/jadrolinija-vijesti-suspension.xml', import.meta.url),
      'utf8',
    );
    const [first] = parseJadrolinijaFeed(xml);
    if (!first) throw new Error('no recorded notice');
    notice = first;
  });

  const on15 = (over: Partial<AffectedItem> = {}) =>
    item({ date: '2026-10-15', lines: ['9603', '635'], ...over });
  const stay = (items: AffectedItem[], spaceId = '00000000-0000-4000-8000-000000000001') =>
    space({ spaceId, checkIn: '2026-10-13', items });

  it('alerts a space with a 9603 item on 15 Oct, with the lines in common', () => {
    const jobs = disruptionAlerts(notice, [stay([on15()])], BEFORE);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.safety as DisruptionAlertFacts).toEqual({
      source: 'Jadrolinija',
      noticeId: 'urn:uuid:81',
      title: 'Linije u prekidu, 15.10.2026',
      url: 'https://www.jadrolinija.hr/hr/novost/linije-u-prekidu15102026',
      timezone: ZONE,
      affected: on15({ lines: ['9603'] }),
    });
  });

  it('skips an item on another day, on another line, or already past', () => {
    const spaces = [
      stay([on15({ date: '2026-10-16' })], 'a'),
      stay([on15({ lines: ['635'] })], 'b'),
    ];
    expect(disruptionAlerts(notice, spaces, BEFORE)).toEqual([]);
    const afterwards = new Date('2026-10-16T10:00:00Z');
    expect(disruptionAlerts(notice, [stay([on15()])], afterwards)).toEqual([]);
  });

  it('names the earliest of two matching items, an Order first on a tie', () => {
    const order = on15({ title: 'Booked trip', orderId: 'o1', startTime: '09:00' });
    const jobs = disruptionAlerts(
      notice,
      [stay([on15({ startTime: '11:00' }), on15({ startTime: '09:00' }), order])],
      BEFORE,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.safety).toMatchObject({ affected: { orderId: 'o1' } });
  });

  it('makes nothing for a notice that names no line', () => {
    const quiet = { ...notice, text: 'U pomorskom prometu nema poteškoća, 15.10.2026' };
    expect(disruptionAlerts(quiet, [stay([on15()])], BEFORE)).toEqual([]);
  });

  it('uses the publication day when the notice has no date', () => {
    const undated = { ...notice, text: 'Katamaranska linija 9603 u prekidu' };
    expect(disruptionAlerts(undated, [stay([on15({ date: '2026-10-14' })])], BEFORE)).toHaveLength(
      1,
    );
  });
});
