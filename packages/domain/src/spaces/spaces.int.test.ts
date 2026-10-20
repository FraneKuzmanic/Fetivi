import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { properties, units } from '../db/schema/properties';
import { pinAttempts, spaces } from '../db/schema/spaces';
import { stays } from '../db/schema/stays';
import { refreshStayTimes, registerStay, updateStay } from '../stays/store';
import { createTestDatabase, type TestDatabase } from '../testing';
import { hashToken } from '../tokens';
import { enterPin, findUnitBySlug, resolveSpace, SpaceRuleError, setSpaceLanguage } from './store';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
// Checkout on the day DST ends in Zagreb: the day ends at 00:00 CET = 23:00 UTC.
const STAY = { checkIn: '2026-10-21', checkout: '2026-10-25', partySize: 2 };
const ACTIVE_UNTIL = new Date('2026-10-25T23:00:00Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

const hex = () => randomBytes(6).toString('hex');

/** An approved property in Europe/Zagreb with two live units; unit 1 has a Stay with `pin`. */
async function seed(pin = '123456') {
  const [host] = await testDb.db
    .insert(accounts)
    .values({ email: `host-${hex()}@example.test`, passwordHash: 'x', role: 'host' })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await testDb.db
    .insert(properties)
    .values({ hostId: host.id, name: 'Villa', timezone: 'Europe/Zagreb', approvedAt: NOW })
    .returning();
  if (!property) throw new Error('no property');
  const unitRows = await testDb.db
    .insert(units)
    .values([1, 2].map((n) => ({ propertyId: property.id, name: `Unit ${n}`, qrSlug: hex() })))
    .returning();
  const [unit1, unit2] = unitRows.map((u) => ({ id: u.id, slug: u.qrSlug as string }));
  if (!unit1 || !unit2) throw new Error('no units');
  const stay = await registerStay(testDb.db, unit1.id, STAY, NOW, { pin: () => pin });
  return { propertyId: property.id, unit1, unit2, stay };
}

/** One device on its own IP. */
const device = () => ({ deviceId: hex(), ip: `ip-${hex()}` });

describe('enterPin', () => {
  it('opens a space with the chosen language that closes when the Stay ends', async () => {
    const { unit1, stay } = await seed();
    const result = await enterPin(testDb.db, {
      slug: unit1.slug,
      pin: '123456',
      language: 'hr',
      ...device(),
      now: NOW,
    });
    if (!result.ok) throw new Error('expected a space');
    expect(result.space.language).toBe('hr');
    expect(result.space.stayId).toBe(stay.id);
    expect(stay.activeUntil).toEqual(ACTIVE_UNTIL);
    expect(result.space.closedAt).toEqual(ACTIVE_UNTIL);
    expect(result.space.tokenHash).toBe(hashToken(result.token));
    const stored = await testDb.db.select().from(spaces).where(eq(spaces.id, result.space.id));
    expect(JSON.stringify(stored)).not.toContain(result.token);
  });

  it('opens a new space on every entry, also on the same device', async () => {
    const { unit1 } = await seed();
    const d = device();
    const entry = () =>
      enterPin(testDb.db, { slug: unit1.slug, pin: '123456', language: 'en', ...d, now: NOW });
    const first = await entry();
    const second = await entry();
    if (!first.ok || !second.ok) throw new Error('expected spaces');
    expect(second.space.id).not.toBe(first.space.id);
    expect(second.token).not.toBe(first.token);
  });

  it("refuses a PIN of another unit's Stay", async () => {
    const { unit2 } = await seed();
    const result = await enterPin(testDb.db, {
      slug: unit2.slug,
      pin: '123456',
      language: 'en',
      ...device(),
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: 'wrong-pin' });
  });

  it('works until the end of checkout day and not at that instant', async () => {
    const { unit1 } = await seed('004211');
    const at = (now: Date) =>
      enterPin(testDb.db, { slug: unit1.slug, pin: '004211', language: 'en', ...device(), now });
    expect((await at(new Date(ACTIVE_UNTIL.getTime() - 1))).ok).toBe(true);
    expect(await at(ACTIVE_UNTIL)).toMatchObject({ ok: false, reason: 'wrong-pin' });
  });

  it('throws not-found for an unknown slug', async () => {
    await expect(
      enterPin(testDb.db, { slug: 'nope', pin: '123456', language: 'en', ...device(), now: NOW }),
    ).rejects.toEqual(new SpaceRuleError('not-found'));
    expect(await findUnitBySlug(testDb.db, 'nope')).toBeNull();
  });
});

describe('closed_at', () => {
  it('moves with the Stay checkout and with a property timezone change', async () => {
    const { unit1, stay, propertyId } = await seed();
    const result = await enterPin(testDb.db, {
      slug: unit1.slug,
      pin: '123456',
      language: 'en',
      ...device(),
      now: NOW,
    });
    if (!result.ok) throw new Error('expected a space');
    const closedAt = async () =>
      (await testDb.db.select().from(spaces).where(eq(spaces.id, result.space.id)))[0]?.closedAt;

    await updateStay(testDb.db, stay.id, { checkout: '2026-10-23' }, NOW);
    expect(await closedAt()).toEqual(new Date('2026-10-23T22:00:00Z'));

    await testDb.db.transaction(async (tx) => {
      await tx
        .update(properties)
        .set({ timezone: 'Europe/London' })
        .where(eq(properties.id, propertyId));
      await refreshStayTimes(tx, { propertyId }, NOW);
    });
    expect(await closedAt()).toEqual(new Date('2026-10-23T23:00:00Z'));
  });

  it('a Stay delete removes its spaces', async () => {
    const { unit1, stay } = await seed();
    const result = await enterPin(testDb.db, {
      slug: unit1.slug,
      pin: '123456',
      language: 'en',
      ...device(),
      now: NOW,
    });
    if (!result.ok) throw new Error('expected a space');
    expect(await resolveSpace(testDb.db, result.token, NOW)).not.toBeNull();
    await testDb.db.delete(stays).where(eq(stays.id, stay.id));
    expect(await resolveSpace(testDb.db, result.token, NOW)).toBeNull();
    const left = await testDb.db.select().from(spaces).where(eq(spaces.id, result.space.id));
    expect(left).toHaveLength(0);
  });
});

describe('resolveSpace and setSpaceLanguage', () => {
  it('resolves the token to its space and unit slug, closed from closed_at', async () => {
    const { unit1 } = await seed();
    const result = await enterPin(testDb.db, {
      slug: unit1.slug,
      pin: '123456',
      language: 'en',
      ...device(),
      now: NOW,
    });
    if (!result.ok) throw new Error('expected a space');
    expect(await resolveSpace(testDb.db, result.token, NOW)).toMatchObject({
      unitSlug: unit1.slug,
      closed: false,
    });
    expect(await resolveSpace(testDb.db, result.token, ACTIVE_UNTIL)).toMatchObject({
      closed: true,
    });
    expect(await resolveSpace(testDb.db, 'garbage', NOW)).toBeNull();
    const updated = await setSpaceLanguage(testDb.db, result.space.id, 'de', NOW);
    expect(updated.language).toBe('de');
  });
});

describe('PIN throttle', () => {
  it('throttles a device after five failures, also for the correct PIN, and clears on success', async () => {
    const { unit1 } = await seed();
    const d = device();
    const attempt = (pin: string, now = NOW) =>
      enterPin(testDb.db, { slug: unit1.slug, pin, language: 'en', ...d, now });
    for (let i = 0; i < 5; i++) {
      expect(await attempt('999999')).toMatchObject({ ok: false, reason: 'wrong-pin' });
    }
    const throttled = await attempt('999999');
    if (throttled.ok) throw new Error('expected a refusal');
    expect(throttled.reason).toBe('throttled');
    expect(throttled.retryAfterMs).toBeGreaterThan(0);
    expect(await attempt('123456')).toMatchObject({ ok: false, reason: 'throttled' });

    expect((await attempt('123456', later(throttled.retryAfterMs))).ok).toBe(true);
    const left = await testDb.db
      .select()
      .from(pinAttempts)
      .where(eq(pinAttempts.deviceId, d.deviceId));
    expect(left).toHaveLength(0);
  });

  it('serialises parallel attempts of one device', async () => {
    const { unit1 } = await seed();
    const d = device();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        enterPin(testDb.db, { slug: unit1.slug, pin: '999999', language: 'en', ...d, now: NOW }),
      ),
    );
    const reasons = results.map((r) => (r.ok ? 'ok' : r.reason));
    expect(reasons.filter((r) => r === 'wrong-pin')).toHaveLength(5);
    expect(reasons.filter((r) => r === 'throttled')).toHaveLength(15);
    const rows = await testDb.db
      .select()
      .from(pinAttempts)
      .where(eq(pinAttempts.deviceId, d.deviceId));
    expect(rows).toHaveLength(5);
  });

  it('deletes failures older than a day on the next attempt', async () => {
    const { unit1, propertyId } = await seed();
    const d = device();
    await testDb.db.insert(pinAttempts).values({
      propertyId,
      ...d,
      createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    });
    await enterPin(testDb.db, { slug: unit1.slug, pin: '999999', language: 'en', ...d, now: NOW });
    const rows = await testDb.db
      .select()
      .from(pinAttempts)
      .where(eq(pinAttempts.deviceId, d.deviceId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdAt).toEqual(NOW);
  });
});
