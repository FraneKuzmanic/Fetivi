import { describe, expect, it } from 'vitest';
import { pinWaitMs } from './throttle';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Attacker {
  ip: string;
  /** Drops the device cookie before every attempt, so each attempt is a fresh device. */
  dropsDevice: boolean;
}

/**
 * Every attacker retries at the earliest instant the throttle allows (one second after an allowed
 * attempt). Returns how many guesses were actually checked, which are all failures.
 */
function simulate(attackers: Attacker[], durationMs: number): number {
  const byDevice = new Map<string, number[]>();
  const byIp = new Map<string, number[]>();
  const property: number[] = [];
  const next = attackers.map(() => 0);
  const deviceOf = attackers.map((_, i) => `d${i}`);
  let deviceSeq = 0;
  let checked = 0;
  for (;;) {
    let i = 0;
    for (let j = 1; j < next.length; j++) if ((next[j] ?? 0) < (next[i] ?? 0)) i = j;
    const now = next[i] ?? 0;
    if (now >= durationMs) return checked;
    const attacker = attackers[i] as Attacker;
    if (attacker.dropsDevice) deviceOf[i] = `fresh${deviceSeq++}`;
    const device = deviceOf[i] as string;
    const history = {
      device: byDevice.get(device) ?? [],
      ip: byIp.get(attacker.ip) ?? [],
      property,
    };
    const wait = pinWaitMs(history, now);
    if (wait > 0) {
      next[i] = now + wait;
      continue;
    }
    checked++;
    byDevice.set(device, [...history.device, now]);
    byIp.set(attacker.ip, [...history.ip, now]);
    property.push(now);
    next[i] = now + SECOND;
  }
}

/** A guest typing: `typos` wrong PINs, then the right one, 10 s per attempt. Total wait in ms. */
function guestWait(
  typos: number,
  start: number,
  property: number[] = [],
): { first: number; total: number } {
  const device: number[] = [];
  const ip: number[] = [];
  let now = start;
  let total = 0;
  let first = -1;
  for (let attempt = 0; attempt <= typos; attempt++) {
    const wait = pinWaitMs({ device, ip, property }, now);
    if (first < 0) first = wait;
    total += wait;
    now += wait;
    if (attempt < typos) {
      device.push(now);
      ip.push(now);
      property.push(now);
      now += 10 * SECOND;
    }
  }
  return { first, total };
}

/** Failure instants of 100 cookie-dropping IPs during their first hour. */
function attackHistory(): number[] {
  const property: number[] = [];
  for (let k = 0; k < 100; k++) for (let n = 0; n < 2; n++) property.push(HOUR - k * SECOND - n);
  return property;
}

describe('pinWaitMs', () => {
  it('never delays a first attempt', () => {
    expect(pinWaitMs({ device: [], ip: [], property: [] }, 0)).toBe(0);
  });

  it('lets one device that keeps its cookie make at most 120 guesses a day', () => {
    expect(simulate([{ ip: 'a', dropsDevice: false }], DAY)).toBeLessThanOrEqual(120);
  });

  // Guesses only hit the unit's own active Stay, usually one PIN out of 10⁶, so a month of
  // guessing from one IP succeeds with about 0.3 % odds.
  it('lets one IP that drops its device cookie make at most 130 guesses a day, 3 000 a month', () => {
    expect(simulate([{ ip: 'a', dropsDevice: true }], DAY)).toBeLessThanOrEqual(130);
    expect(simulate([{ ip: 'a', dropsDevice: true }], 30 * DAY)).toBeLessThanOrEqual(3000);
  });

  it('holds 100 cookie-dropping IPs to at most 3 000 guesses a day through slow mode', () => {
    const attackers = Array.from({ length: 100 }, (_, i) => ({ ip: `ip${i}`, dropsDevice: true }));
    expect(simulate(attackers, DAY)).toBeLessThanOrEqual(3000);
  });

  it('lets a guest with typos in without a long wait', () => {
    expect(guestWait(0, 0)).toEqual({ first: 0, total: 0 });
    expect(guestWait(4, 0).total).toBe(0);
    const sevenTypos = guestWait(7, 0);
    expect(sevenTypos.first).toBe(0);
    expect(sevenTypos.total).toBeLessThanOrEqual(4 * MINUTE);
  });

  it('lets a guest on a fresh device and IP in during a 100-IP attack', () => {
    const during = guestWait(2, HOUR, attackHistory());
    expect(during.first).toBe(0);
    expect(during.total).toBeLessThanOrEqual(5 * MINUTE);
  });

  it('never waits longer than 60 minutes for any history', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const instants = (max: number) =>
      Array.from({ length: Math.floor(random() * max) }, () => Math.floor(random() * DAY));
    for (let i = 0; i < 2000; i++) {
      const wait = pinWaitMs(
        { device: instants(50), ip: instants(200), property: instants(500) },
        DAY,
      );
      expect(Number.isFinite(wait)).toBe(true);
      expect(wait).toBeGreaterThanOrEqual(0);
      expect(wait).toBeLessThanOrEqual(60 * MINUTE);
    }
  });
});
