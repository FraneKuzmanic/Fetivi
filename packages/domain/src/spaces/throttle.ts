import { PIN_LIMITS } from './vocabulary';

// The PIN throttle as a pure function over failure instants, so the guessing simulation and the
// store share one rule. Only failures count; a throttled attempt is refused before the PIN is
// looked at and records nothing.

export interface AttemptHistory {
  /** Failure instants (ms) of this device / IP / property, any order, windowed or not. */
  device: number[];
  ip: number[];
  property: number[];
}

function keyWait(
  failures: number[],
  now: number,
  limit: { windowMs: number; free: number; baseMs: number; capMs: number },
): number {
  const recent = failures.filter((t) => t > now - limit.windowMs && t <= now);
  if (recent.length < limit.free) return 0;
  const wait = Math.min(limit.baseMs * 2 ** (recent.length - limit.free), limit.capMs);
  const latest = Math.max(...recent);
  return Math.max(0, latest + wait - now);
}

/** 0 = the attempt may be checked now; otherwise ms until it may. Never infinite. */
export function pinWaitMs(h: AttemptHistory, now: number): number {
  const slow =
    h.property.filter((t) => t > now - PIN_LIMITS.property.windowMs && t <= now).length >=
    PIN_LIMITS.property.slowAt;
  const device = slow ? { ...PIN_LIMITS.device, free: PIN_LIMITS.slow.free } : PIN_LIMITS.device;
  const ip = slow
    ? { ...PIN_LIMITS.ip, free: PIN_LIMITS.slow.free, capMs: PIN_LIMITS.slow.ipCapMs }
    : PIN_LIMITS.ip;
  return Math.max(keyWait(h.device, now, device), keyWait(h.ip, now, ip));
}
