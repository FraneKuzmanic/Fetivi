import {
  createJobQueue,
  createOrder,
  orderProposals,
  reconciliationFindings,
  reconciliationRuns,
} from '@fetivi/domain';
import { seedGuestUnit, seedOrderableOffer, seedProvider } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  get,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostCookie: string;
let adminCookie: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
});

const overview = async () => (await get(t.app, '/api/admin/overview', adminCookie)).json();

describe('admin overview', () => {
  it('is for the admin only', async () => {
    expect((await get(t.app, '/api/admin/overview')).statusCode).toBe(401);
    expect((await get(t.app, '/api/admin/overview', hostCookie)).statusCode).toBe(403);
  });

  it('counts what waits in each queue', async () => {
    const before = await overview();
    expect(before).toEqual({
      approvalsPending: expect.any(Number),
      curationOpen: expect.any(Number),
      curationNeedsVisit: expect.any(Number),
      recordsDue: expect.any(Number),
      paymentProblems: expect.any(Number),
      ordersNeedAction: expect.any(Number),
    });

    await post(t.app, '/api/host/properties', { name: 'Villa', city: 'Split' }, hostCookie);

    const now = t.clock.now();
    const [run] = await t.db
      .insert(reconciliationRuns)
      .values({ trigger: 'schedule', startedAt: now, finishedAt: now })
      .returning();
    const base = { runId: run?.id as string, firstSeenAt: now, lastSeenAt: now, detail: 'x' };
    await t.db.insert(reconciliationFindings).values([
      { ...base, kind: 'orphan_session', subject: 'session:a:1', status: 'needs_attention' },
      { ...base, kind: 'hold_expired', subject: 'hold:1', status: 'resolved', resolvedAt: now },
    ]);

    // One Order waiting for the Provider past its window, one still within it.
    const guest = await seedGuestUnit(t.db, { now });
    const provider = await seedProvider(t.db);
    const { offerId } = await seedOrderableOffer(t.db, {
      providerId: provider.id,
      availabilityMode: 'on_request',
    });
    const deps = { db: t.db, queue: createJobQueue(t.boss), now: t.clock.now };
    const input = {
      spaceId: guest.spaceId,
      offerId,
      date: guest.stay.checkIn,
      quantity: 1,
      contact: { email: 'guest@example.test' },
    };
    const { order: missed } = await createOrder(deps, input);
    await createOrder(deps, input);
    await t.db
      .update(orderProposals)
      .set({ responseDueAt: new Date(now.getTime() - 60_000) })
      .where(eq(orderProposals.id, missed.currentProposalId as string));

    const after = await overview();
    expect(after).toEqual({
      ...before,
      approvalsPending: before.approvalsPending + 1,
      paymentProblems: before.paymentProblems + 1,
      ordersNeedAction: before.ordersNeedAction + 1,
    });
  });
});
