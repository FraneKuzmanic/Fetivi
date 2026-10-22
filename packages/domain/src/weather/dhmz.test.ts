import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { latestReading, maxReading, parseCapWarnings, parseStationTable } from './dhmz';
import { WeatherFeedError } from './errors';

const recorded = (name: string) =>
  readFileSync(new URL(`./recorded/${name}`, import.meta.url), 'utf8');

const CAP_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>x</identifier></alert>`;

const CAP_ONE = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <info>
    <language>en</language>
    <event>Orange coastal event warning</event>
    <onset>2026-07-10T12:00:00+02:00</onset>
    <expires>2026-07-10 20:00:00+02:00</expires>
    <description>High waves &amp; spray.</description>
    <parameter><valueName>awareness_level</valueName><value>3; orange; Severe</value></parameter>
    <parameter><valueName>awareness_type</valueName><value>7; coastalevent</value></parameter>
    <area><areaDesc>Middle Dalmatia region</areaDesc>
      <geocode><valueName>EMMA_ID</valueName><value>HR805</value></geocode></area>
  </info>
</alert>`;

describe('parseStationTable', () => {
  it('reads the sea temperature table', () => {
    const table = parseStationTable(recorded('more_n.xml'), 'Temperature_mora');
    expect(table.date).toBe('2026-10-22');
    expect(table.hours).toEqual(['07', '08', '11', '14', '15', '17']);
    expect(table.rows).toHaveLength(16);
    expect(table.rows.find((r) => r.station === 'Split')?.values).toEqual([
      null,
      20,
      null,
      20,
      null,
      null,
    ]);
    // '-' is no value.
    expect(
      table.rows.find((r) => r.station === 'Crikvenica')?.values.every((v) => v === null),
    ).toBe(true);
  });

  it('reads UV cells that carry a colour attribute', () => {
    const table = parseStationTable(recorded('uvi.xml'), 'UV_indeks');
    expect(table.hours[0]).toBe('06');
    expect(table.rows.map((r) => r.station)).toEqual(['Opatija', 'Malinska', 'Crikvenica']);
    expect(table.rows[0]?.values[3]).toBe(0.3);
  });

  it('throws on malformed XML or the wrong root', () => {
    expect(() => parseStationTable('<Temperature_mora>', 'Temperature_mora')).toThrow(
      WeatherFeedError,
    );
    expect(() => parseStationTable(recorded('uvi.xml'), 'Temperature_mora')).toThrow(
      WeatherFeedError,
    );
  });
});

describe('station readings', () => {
  const sea = parseStationTable(recorded('more_n.xml'), 'Temperature_mora');
  const uv = parseStationTable(recorded('uvi.xml'), 'UV_indeks');

  it('takes the last value of the day with its local hour', () => {
    expect(latestReading(sea, 'Split')).toEqual({ value: 20, measuredAt: '2026-10-22T14:00' });
    expect(latestReading(sea, 'Mali Lošinj')).toEqual({
      value: 20.9,
      measuredAt: '2026-10-22T17:00',
    });
  });

  it('gives null for a station with no value or not in the feed', () => {
    expect(latestReading(sea, 'Crikvenica')).toBeNull();
    expect(latestReading(sea, 'Hvar')).toBeNull();
  });

  it('takes the highest UV so far', () => {
    expect(maxReading(uv, 'Crikvenica')).toEqual({ value: 1.3, measuredAt: '2026-10-22T12:00' });
  });
});

describe('parseCapWarnings', () => {
  it('reads every yellow-or-above info in both languages', () => {
    const warnings = parseCapWarnings(recorded('cap_hr_today.xml'));
    expect(warnings).toHaveLength(20);
    const middle = warnings.find((w) => w.language === 'en' && w.areas[0]?.id === 'HR805');
    expect(middle).toEqual({
      language: 'en',
      event: 'Yellow wind warning',
      description: expect.any(String),
      level: 'yellow',
      type: 'wind',
      onset: '2026-10-22T14:00:00.000Z',
      expires: '2026-10-22T21:59:59.000Z',
      areas: [{ id: 'HR805', name: 'Middle Dalmatia region' }],
    });
    expect(warnings.filter((w) => w.language === 'hr')).toHaveLength(10);
  });

  it('skips green infos and keeps only EMMA_ID geocodes', () => {
    const warnings = parseCapWarnings(recorded('cap_hr_day_after_tomorrow.xml'));
    expect(warnings.every((w) => w.level !== ('green' as never))).toBe(true);
    const split = warnings.filter((w) => w.areas.some((a) => a.id === 'HR027'));
    expect(split.map((w) => [w.language, w.type, w.areas])).toEqual([
      ['hr', 'thunderstorm', [{ id: 'HR027', name: 'Splitsko-dalmatinska' }]],
      ['en', 'thunderstorm', [{ id: 'HR027', name: 'Splitsko-dalmatinska' }]],
    ]);
    // The Primorsko-goranska info also has NUTS3 HR031, which must not read as EMMA HR031 Zagreb.
    const today = parseCapWarnings(recorded('cap_hr_today.xml'));
    expect(today.flatMap((w) => w.areas.map((a) => a.id))).not.toContain('HR031');
  });

  it('gives [] for an alert with no info, and reads a single info', () => {
    expect(parseCapWarnings(CAP_EMPTY)).toEqual([]);
    const [one] = parseCapWarnings(CAP_ONE);
    expect(one).toMatchObject({
      level: 'orange',
      type: 'coastal_event',
      onset: '2026-07-10T10:00:00.000Z',
      expires: '2026-07-10T18:00:00.000Z',
      description: 'High waves & spray.',
    });
  });

  it('maps an unknown type to other', () => {
    const xml = CAP_ONE.replace('7; coastalevent', '42; something');
    expect(parseCapWarnings(xml)[0]?.type).toBe('other');
  });

  it('throws on malformed XML or a missing alert', () => {
    expect(() => parseCapWarnings('<alert><info></alert>')).toThrow(WeatherFeedError);
    expect(() => parseCapWarnings('<html></html>')).toThrow(WeatherFeedError);
  });
});
