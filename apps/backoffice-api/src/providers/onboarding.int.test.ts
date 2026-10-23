import { providers } from '@fetivi/domain';
import { fakePaymentGateway } from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdmin } from '../cli/create-admin';
import {
  createTestApp,
  loginAs,
  PASSWORD,
  post,
  signUpVerifiedHost,
  TEST_ORIGIN,
  type TestApp,
} from '../testing';

const gateway = fakePaymentGateway();
let t: TestApp;
let bare: TestApp;
let adminCookie: string;
let hostCookie: string;
let providerId: string;

beforeAll(async () => {
  t = await createTestApp({ stripe: { gateway } });
  bare = await createTestApp();
  await signUpVerifiedHost(t, 'host@example.test');
  hostCookie = await loginAs(t, 'host@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  const provider = await post(
    t.app,
    '/api/admin/providers',
    { name: 'Mare Trogir Boats', email: 'bookings@mare.example', commissionBp: 1_250 },
    adminCookie,
  );
  providerId = provider.json().id;
});

afterAll(async () => {
  await t?.close();
  await bare?.close();
});

const linkUrl = (id = providerId) => `/api/admin/providers/${id}/stripe/onboarding-link`;
const refreshUrl = (id = providerId) => `/api/admin/providers/${id}/stripe/refresh`;

describe('Provider payment onboarding', () => {
  it('creates the connected account once and returns a fresh link each time', async () => {
    const first = await post(t.app, linkUrl(), undefined, adminCookie);
    expect(first.statusCode).toBe(200);
    expect(first.json().url).toMatch(/^https:\/\//);
    expect(Date.parse(first.json().expiresAt)).not.toBeNaN();
    const second = await post(t.app, linkUrl(), undefined, adminCookie);
    expect(second.statusCode).toBe(200);
    expect(second.json().url).not.toBe(first.json().url);

    const creates = gateway.calls.filter((c) => c.op === 'create_account');
    expect(creates).toHaveLength(1);
    expect(creates[0]?.idempotencyKey).toBe(`provider:${providerId}:account`);
    const links = gateway.calls.filter((c) => c.op === 'account_link');
    expect(links.at(-1)?.params).toMatchObject({
      returnUrl: `${TEST_ORIGIN}/admin/providers/${providerId}?stripe=return`,
      refreshUrl: `${TEST_ORIGIN}/admin/providers/${providerId}?stripe=refresh`,
    });
    const [row] = await t.db.select().from(providers).where(eq(providers.id, providerId));
    expect(row?.stripeAccountId).toBe(gateway.state().accounts[0]?.id);
  });

  it('stores the card status on refresh and shows it without the raw account id', async () => {
    const accountId = gateway.state().accounts[0]?.id as string;
    const pending = await post(t.app, refreshUrl(), undefined, adminCookie);
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toMatchObject({ stripeConnected: true, stripeCardPayments: 'pending' });
    gateway.setCardStatus(accountId, 'active');
    t.clock.advance(60_000);
    const active = await post(t.app, refreshUrl(), undefined, adminCookie);
    expect(active.json().stripeCardPayments).toBe('active');
    expect(active.json().stripeCheckedAt).toBe(t.clock.now().toISOString());
    expect(JSON.stringify(active.json())).not.toContain(accountId);
  });

  it('answers 409 on refresh before onboarding, 404 for an unknown Provider', async () => {
    const other = await post(
      t.app,
      '/api/admin/providers',
      { name: 'Other Boats', email: 'other@boats.example', commissionBp: 1_000 },
      adminCookie,
    );
    const refresh = await post(t.app, refreshUrl(other.json().id), undefined, adminCookie);
    expect(refresh.statusCode).toBe(409);
    expect(refresh.json()).toEqual({ error: 'no-account' });
    const unknown = await post(
      t.app,
      linkUrl('00000000-0000-4000-8000-000000000000'),
      undefined,
      adminCookie,
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('maps a Stripe outage to 502', async () => {
    gateway.failNext('account_link', 'unavailable');
    const response = await post(t.app, linkUrl(), undefined, adminCookie);
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'stripe-unavailable' });
  });

  it('is admin only', async () => {
    expect((await post(t.app, linkUrl(), undefined, hostCookie)).statusCode).toBe(403);
  });

  it('answers 503 without a Stripe key', async () => {
    await createAdmin(bare.db, 'admin@example.test', PASSWORD);
    const cookie = await loginAs(bare, 'admin@example.test');
    const provider = await post(
      bare.app,
      '/api/admin/providers',
      { name: 'Bare Boats', email: 'bare@boats.example', commissionBp: 1_000 },
      cookie,
    );
    const response = await post(bare.app, linkUrl(provider.json().id), undefined, cookie);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'payments-not-configured' });
  });
});
