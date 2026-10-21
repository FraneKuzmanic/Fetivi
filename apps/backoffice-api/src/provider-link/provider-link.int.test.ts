import { randomUUID } from 'node:crypto';
import {
  allotmentSlots,
  cancel,
  confirmHeldOrder,
  createJobQueue,
  createOrder,
  hashToken,
  issueProviderLink,
  type OrderDeps,
  offers,
  orderProposals,
  orders,
  providers,
  QUEUES,
} from '@fetivi/domain';
import {
  type SeededGuestUnit,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, get, TEST_ORIGIN, type TestApp } from '../testing';

let t: TestApp;
let unit: SeededGuestUnit;

const SECRET = 'api-test-secret-that-is-long-enough-0000';
// createTestApp's clock starts at 2026-10-19T10:00Z; seedGuestUnit checks in two days later.
const NOW = new Date('2026-10-19T10:00:00Z');
const DAY = '2026-10-22';
const SLOT_AT = new Date('2026-10-22T07:00:00Z'); // 09:00 in Zagreb

const orderDeps = (): OrderDeps => ({
  db: t.db,
  queue: createJobQueue(t.boss),
  now: t.clock.now,
});

beforeAll(async () => {
  t = await createTestApp();
  unit = await seedGuestUnit(t.db, { now: NOW });
});

afterAll(async () => {
  await t?.close();
});

async function confirmedOrder(options: { title?: string } = {}) {
  const provider = await seedProvider(t.db);
  const { offerId, slotId } = await seedOrderableOffer(t.db, {
    providerId: provider.id,
    availabilityMode: 'allotment',
    capacity: 4,
    startsAt: SLOT_AT,
    contactFields: 'name',
  });
  if (!slotId) throw new Error('no slot');
  if (options.title) {
    await t.db.update(offers).set({ title: options.title }).where(eq(offers.id, offerId));
  }
  const { order } = await createOrder(orderDeps(), {
    spaceId: unit.spaceId,
    offerId,
    slotId,
    date: DAY,
    quantity: 2,
    contact: { email: 'ana@example.test', name: 'Ana Horvat', phone: '+385 91 000 0000' },
    hold: { expiresAt: new Date(NOW.getTime() + 30 * 60_000) },
  });
  const ref = { orderId: order.id, proposalId: order.currentProposalId as string };
  await confirmHeldOrder(orderDeps(), ref);
  const token = await issueProviderLink(t.db, SECRET, order.id);
  return { ref, slotId, token, providerId: provider.id, url: `/api/provider-link/${token}` };
}

function postForm(url: string, form: Record<string, string>, origin: string | null = TEST_ORIGIN) {
  return t.app.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(origin ? { origin } : {}),
    },
    payload: new URLSearchParams(form).toString(),
  });
}

async function state(ref: { orderId: string; proposalId: string }, slotId: string) {
  const [order] = await t.db.select().from(orders).where(eq(orders.id, ref.orderId));
  const [proposal] = await t.db
    .select()
    .from(orderProposals)
    .where(eq(orderProposals.id, ref.proposalId));
  const [slot] = await t.db.select().from(allotmentSlots).where(eq(allotmentSlots.id, slotId));
  return {
    status: order?.status,
    acknowledgedAt: proposal?.providerAcknowledgedAt ?? null,
    remaining: slot?.remaining,
  };
}

describe('the page', () => {
  it('is Croatian by default, with the configured guest field only', async () => {
    const { url, ref } = await confirmedOrder();
    const response = await get(t.app, url);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('same-origin');
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    const body = response.body;
    expect(body).toContain('<html lang="hr">');
    expect(body).toContain('name="viewport"');
    expect(body).toContain('Kayak tour');
    expect(body).toContain('09:00');
    expect(body).toContain('Ana Horvat');
    expect(body).not.toContain('+385 91 000 0000');
    expect(body).not.toContain('ana@example.test');
    expect(body).toContain('Primljeno');
    expect(body).toContain(`value="${ref.proposalId}"`);
  });

  it("is English with ?lang=en and when it is the Provider's language", async () => {
    const { url, providerId } = await confirmedOrder();
    const byQuery = await get(t.app, `${url}?lang=en`);
    expect(byQuery.body).toContain('<html lang="en">');
    expect(byQuery.body).toContain('Got it');
    await t.db.update(providers).set({ language: 'en' }).where(eq(providers.id, providerId));
    expect((await get(t.app, url)).body).toContain('<html lang="en">');
    expect((await get(t.app, `${url}?lang=hr`)).body).toContain('<html lang="hr">');
    expect((await get(t.app, `${url}?lang=de`)).body).toContain('<html lang="en">');
  });

  it('escapes Offer text', async () => {
    const { url } = await confirmedOrder({ title: '<script>alert(1)</script> & "tour"' });
    const body = (await get(t.app, url)).body;
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;tour&quot;');
  });

  it('writes nothing on GET', async () => {
    const { url, ref, slotId } = await confirmedOrder();
    const before = await state(ref, slotId);
    await get(t.app, url);
    await get(t.app, `${url}?done=cancelled`);
    expect(await state(ref, slotId)).toEqual(before);
  });

  it('shows a final Order closed, with no form', async () => {
    const { url, ref } = await confirmedOrder();
    await cancel(orderDeps(), { ...ref, trigger: 'guest' });
    const body = (await get(t.app, url)).body;
    expect(body).toContain('Otkazana');
    expect(body).not.toContain('<form');
    expect(body).not.toContain('Ana Horvat');
  });
});

describe('an unknown token', () => {
  it('gets the same 404 page however it is wrong', async () => {
    const { token, ref } = await confirmedOrder();
    const flipped = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    const misses = [flipped, hashToken(token), ref.orderId, 'x'.repeat(43), 'short'];
    const [first, ...rest] = await Promise.all(
      misses.map((m) => get(t.app, `/api/provider-link/${encodeURIComponent(m)}`)),
    );
    expect(first?.statusCode).toBe(404);
    expect(first?.body).toContain('<html lang="hr">');
    for (const response of rest) {
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(first?.body);
    }
    const posted = await postForm(`/api/provider-link/${flipped}`, {
      action: 'acknowledge',
      proposalId: ref.proposalId,
    });
    expect(posted.statusCode).toBe(404);
    expect(posted.body).toBe(first?.body);
  });
});

describe('Got it', () => {
  it('records the acknowledgement and redirects back, once', async () => {
    const { url, ref, slotId } = await confirmedOrder();
    const response = await postForm(url, { action: 'acknowledge', proposalId: ref.proposalId });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(`${url}?lang=hr&done=acknowledged`);
    const after = await state(ref, slotId);
    expect(after.acknowledgedAt).not.toBeNull();
    expect(after.status).toBe('confirmed');

    const again = await postForm(url, { action: 'acknowledge', proposalId: ref.proposalId });
    expect(again.headers.location).toBe(`${url}?lang=hr&done=unchanged`);
    const page = (await get(t.app, `${url}?lang=hr&done=acknowledged`)).body;
    expect(page).toContain('Primitak potvrđen');
    expect(page).toContain('Hvala, primitak je zabilježen.');
    expect(page).not.toContain('value="acknowledge"');
    expect(page).toContain('value="cannot_fulfil"');
  });

  it('is refused without the page origin', async () => {
    const { url, ref, slotId } = await confirmedOrder();
    const missing = await postForm(
      url,
      { action: 'acknowledge', proposalId: ref.proposalId },
      null,
    );
    expect(missing.statusCode).toBe(403);
    const foreign = await postForm(
      url,
      { action: 'acknowledge', proposalId: ref.proposalId },
      'https://evil.test',
    );
    expect(foreign.statusCode).toBe(403);
    expect((await state(ref, slotId)).acknowledgedAt).toBeNull();
  });
});

describe("Can't fulfil", () => {
  it('asks first, then cancels, returns the seats and alerts the admin', async () => {
    const { url, ref, slotId } = await confirmedOrder();
    const before = await state(ref, slotId);
    const ask = await postForm(url, { action: 'cannot_fulfil', proposalId: ref.proposalId });
    expect(ask.statusCode).toBe(200);
    expect(ask.body).toContain('value="cannot_fulfil_confirmed"');
    expect(await state(ref, slotId)).toEqual(before);

    const confirmed = await postForm(url, {
      action: 'cannot_fulfil_confirmed',
      proposalId: ref.proposalId,
      lang: 'en',
    });
    expect(confirmed.statusCode).toBe(303);
    expect(confirmed.headers.location).toBe(`${url}?lang=en&done=cancelled`);
    const after = await state(ref, slotId);
    expect(after.status).toBe('cancelled');
    expect(after.remaining).toBe(4);
    const { rows } = await t.db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job where name = ${QUEUES.orderNotify}
          and data->>'orderId' = ${ref.orderId} and data->>'kind' = 'admin_provider_cancelled'`,
    );
    expect(rows[0]?.n).toBe(1);
    const page = (await get(t.app, `${url}?lang=en&done=cancelled`)).body;
    expect(page).toContain('Cancelled');
    expect(page).not.toContain('<form');
  });
});

describe('a stale page', () => {
  it('does nothing and says the Order changed', async () => {
    const { url, ref, slotId } = await confirmedOrder();
    const before = await state(ref, slotId);
    const old = randomUUID();
    for (const action of ['acknowledge', 'cannot_fulfil', 'cannot_fulfil_confirmed']) {
      const response = await postForm(url, { action, proposalId: old });
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toBe(`${url}?lang=hr&done=stale`);
    }
    expect(await state(ref, slotId)).toEqual(before);
  });

  it('answers a malformed form with a 400 page', async () => {
    const { url, ref, slotId } = await confirmedOrder();
    const before = await state(ref, slotId);
    const response = await postForm(url, { action: 'delete', proposalId: ref.proposalId });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(await state(ref, slotId)).toEqual(before);
  });
});
