import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../db/schema/accounts';
import { properties, units } from '../db/schema/properties';
import { stays } from '../db/schema/stays';
import { createTestDatabase, type TestDatabase } from '../testing';
import type { PinSource } from './pin';
import { StayRuleError } from './rules';
import { refreshStayTimes, registerStay, updateStay } from './store';

let testDb: TestDatabase;
const NOW = new Date('2026-10-19T10:00:00Z');
const at = (iso: string) => new Date(iso);
const stay = { checkIn: '2026-10-21', checkout: '2026-10-24', partySize: 2 };

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb?.drop();
});

/** A host with one property in Europe/Zagreb and `unitCount` units. */
async function seed(
  options: { approved?: boolean; qr?: boolean; suspended?: boolean; unitCount?: number } = {},
) {
  const { approved = true, qr = true, suspended = false, unitCount = 2 } = options;
  const [host] = await testDb.db
    .insert(accounts)
    .values({
      email: `host-${randomBytes(4).toString('hex')}@example.test`,
      passwordHash: 'x',
      role: 'host',
      suspendedAt: suspended ? NOW : null,
    })
    .returning();
  if (!host) throw new Error('no host');
  const [property] = await testDb.db
    .insert(properties)
    .values({
      hostId: host.id,
      name: 'Villa',
      timezone: 'Europe/Zagreb',
      approvedAt: approved ? NOW : null,
    })
    .returning();
  if (!property) throw new Error('no property');
  const unitRows = await testDb.db
    .insert(units)
    .values(
      Array.from({ length: unitCount }, (_, i) => ({
        propertyId: property.id,
        name: `Unit ${i + 1}`,
        qrSlug: qr ? randomBytes(6).toString('hex') : null,
      })),
    )
    .returning();
  return { hostId: host.id, propertyId: property.id, unitIds: unitRows.map((u) => u.id) };
}

/** Returns the given PINs in order, then repeats the last one. */
const pins =
  (...values: string[]): PinSource =>
  () =>
    values.length > 1 ? (values.shift() as string) : (values[0] as string);

const ruleCode = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof StayRuleError ? error.code : String(error)),
  );

describe('registerStay PIN uniqueness', () => {
  it('keeps PINs unique among the property when registrations run at the same moment', async () => {
    const { unitIds } = await seed();
    // Open the pool's connections first so the transactions really overlap instead of queueing
    // behind connection setup.
    const clients = await Promise.all(Array.from({ length: 10 }, () => testDb.pool.connect()));
    for (const client of clients) client.release();
    // Without the property row lock several calls would read an empty set of active PINs and
    // all take 111111.
    const rows = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        registerStay(testDb.db, unitIds[i % 2] as string, stay, NOW, {
          pin: pins('111111', `2000${String(i).padStart(2, '0')}`),
        }),
      ),
    );
    const drawn = rows.map((r) => r.pin);
    expect(new Set(drawn).size).toBe(12);
    expect(drawn.filter((p) => p === '111111')).toHaveLength(1);
  });

  it('allows the same PIN in another property', async () => {
    const a = await seed();
    const b = await seed();
    const first = await registerStay(testDb.db, a.unitIds[0] as string, stay, NOW, {
      pin: pins('111111'),
    });
    const second = await registerStay(testDb.db, b.unitIds[0] as string, stay, NOW, {
      pin: pins('111111'),
    });
    expect([first.pin, second.pin]).toEqual(['111111', '111111']);
  });

  it('frees a PIN exactly at the end of checkout day in the property timezone', async () => {
    const { unitIds } = await seed();
    const unitId = unitIds[0] as string;
    const ending = { checkIn: '2026-10-18', checkout: '2026-10-20', partySize: 2 };
    await registerStay(testDb.db, unitId, ending, NOW, { pin: pins('111111') });
    const next = { checkIn: '2026-10-21', checkout: '2026-10-23', partySize: 2 };

    // 23:59:59.999 on 20 October in Zagreb (CEST): the first Stay is still active.
    const before = await registerStay(testDb.db, unitId, next, at('2026-10-20T21:59:59.999Z'), {
      pin: pins('111111', '333333'),
    });
    expect(before.pin).toBe('333333');

    // 00:00 on 21 October in Zagreb: the first Stay has ended and its PIN is free again.
    const after = await registerStay(testDb.db, unitId, next, at('2026-10-20T22:00:00.000Z'), {
      pin: pins('111111', '444444'),
    });
    expect(after.pin).toBe('111111');
  });

  it('keeps leading zeros', async () => {
    const { unitIds } = await seed();
    const row = await registerStay(testDb.db, unitIds[0] as string, stay, NOW, {
      pin: pins('004217'),
    });
    const [stored] = await testDb.db.select().from(stays).where(eq(stays.id, row.id));
    expect(stored?.pin).toBe('004217');
  });

  it('draws a random six-digit PIN by default and stores the derived instants', async () => {
    const { unitIds } = await seed();
    const row = await registerStay(testDb.db, unitIds[0] as string, stay, NOW);
    expect(row.pin).toMatch(/^\d{6}$/);
    expect(row.arrivalReleaseAt.toISOString()).toBe('2026-10-19T22:00:00.000Z');
    expect(row.activeUntil.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(row.possiblyCancelled).toBe(false);
    expect(row.pinSentAt).toBeNull();
  });
});

describe('registerStay live rule', () => {
  it('rejects a unit of an unapproved property', async () => {
    const { unitIds } = await seed({ approved: false });
    expect(await ruleCode(registerStay(testDb.db, unitIds[0] as string, stay, NOW))).toBe(
      'unit-not-live',
    );
  });

  it('rejects a unit without a QR link', async () => {
    const { unitIds } = await seed({ qr: false });
    expect(await ruleCode(registerStay(testDb.db, unitIds[0] as string, stay, NOW))).toBe(
      'unit-not-live',
    );
  });

  it('rejects a suspended host', async () => {
    const { unitIds } = await seed({ suspended: true });
    expect(await ruleCode(registerStay(testDb.db, unitIds[0] as string, stay, NOW))).toBe(
      'account-suspended',
    );
  });

  it('rejects invalid dates and an unknown unit', async () => {
    const { unitIds } = await seed();
    const bad = { ...stay, checkout: stay.checkIn };
    expect(await ruleCode(registerStay(testDb.db, unitIds[0] as string, bad, NOW))).toBe(
      'invalid-input',
    );
    expect(
      await ruleCode(registerStay(testDb.db, '00000000-0000-0000-0000-000000000000', stay, NOW)),
    ).toBe('not-found');
  });
});

describe('updateStay', () => {
  it('keeps the PIN, recomputes the instants and sets or clears the PIN-sent tick', async () => {
    const { unitIds } = await seed();
    const row = await registerStay(testDb.db, unitIds[0] as string, stay, NOW);
    const moved = await updateStay(
      testDb.db,
      row.id,
      { checkIn: '2026-10-25', checkout: '2026-10-28', pinSent: true },
      NOW,
    );
    expect(moved.pin).toBe(row.pin);
    expect(moved.arrivalReleaseAt.toISOString()).toBe('2026-10-23T22:00:00.000Z');
    expect(moved.activeUntil.toISOString()).toBe('2026-10-28T23:00:00.000Z');
    expect(moved.pinSentAt?.toISOString()).toBe(NOW.toISOString());

    const later = at('2026-10-20T08:00:00Z');
    const again = await updateStay(testDb.db, row.id, { pinSent: true }, later);
    expect(again.pinSentAt?.toISOString()).toBe(NOW.toISOString());
    const cleared = await updateStay(testDb.db, row.id, { pinSent: false }, later);
    expect(cleared.pinSentAt).toBeNull();
  });

  it('refuses to change an ended Stay', async () => {
    const { unitIds } = await seed();
    const row = await registerStay(testDb.db, unitIds[0] as string, stay, NOW);
    expect(await ruleCode(updateStay(testDb.db, row.id, { partySize: 3 }, row.activeUntil))).toBe(
      'stay-ended',
    );
  });
});

describe('refreshStayTimes', () => {
  it('moves the release time of active Stays and leaves ended ones alone', async () => {
    const { unitIds } = await seed();
    const unitId = unitIds[0] as string;
    const ended = await registerStay(
      testDb.db,
      unitId,
      { checkIn: '2026-10-18', checkout: '2026-10-20', partySize: 1 },
      NOW,
    );
    const active = await registerStay(testDb.db, unitId, stay, NOW);
    const later = at('2026-10-21T08:00:00Z');

    await testDb.db.transaction(async (tx) => {
      await tx.update(units).set({ arrivalReleaseDaysBefore: 3 }).where(eq(units.id, unitId));
      await refreshStayTimes(tx, { unitId }, later);
    });

    const [a] = await testDb.db.select().from(stays).where(eq(stays.id, active.id));
    const [e] = await testDb.db.select().from(stays).where(eq(stays.id, ended.id));
    expect(a?.arrivalReleaseAt.toISOString()).toBe('2026-10-17T22:00:00.000Z');
    expect(e?.arrivalReleaseAt.toISOString()).toBe(ended.arrivalReleaseAt.toISOString());
  });
});
