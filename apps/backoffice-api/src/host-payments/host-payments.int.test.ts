import { accounts } from '@fetivi/domain';
import { fakePaymentGateway } from '@fetivi/domain/testing';
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
  TEST_ORIGIN,
  type TestApp,
} from '../testing';

const gateway = fakePaymentGateway();
let t: TestApp;
let bare: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;

async function host(app: TestApp, email: string) {
  await signUpVerifiedHost(app, email);
  const [row] = await app.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(app, email) };
}

const LINK = '/api/host/payments/stripe/onboarding-link';
const REFRESH = '/api/host/payments/stripe/refresh';

beforeAll(async () => {
  t = await createTestApp({ stripe: { gateway } });
  bare = await createTestApp();
  hostA = await host(t, 'a@example.test');
  hostB = await host(t, 'b@example.test');
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
});

afterAll(async () => {
  await t?.close();
  await bare?.close();
});

const storedAccount = async (id: string) =>
  (await t.db.select().from(accounts).where(eq(accounts.id, id)))[0]?.stripeAccountId;

describe('host payments', () => {
  it('starts unconnected', async () => {
    const response = await get(t.app, '/api/host/payments', hostA.cookie);
    expect(response.json()).toEqual({
      stripeConnected: false,
      stripeCardPayments: null,
      stripeCheckedAt: null,
    });
  });

  it("creates the host's account once with host metadata, and a fresh link each time", async () => {
    const first = await post(t.app, LINK, undefined, hostA.cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json().url).toMatch(/^https:\/\//);
    const second = await post(t.app, LINK, undefined, hostA.cookie);
    expect(second.json().url).not.toBe(first.json().url);

    const creates = gateway.calls.filter((c) => c.op === 'create_account');
    expect(creates).toHaveLength(1);
    expect(creates[0]?.idempotencyKey).toBe(`host:${hostA.id}:account`);
    const links = gateway.calls.filter((c) => c.op === 'account_link');
    expect(links.at(-1)?.params).toMatchObject({
      returnUrl: `${TEST_ORIGIN}/services?stripe=return`,
      refreshUrl: `${TEST_ORIGIN}/services?stripe=refresh`,
    });
    const id = await storedAccount(hostA.id);
    const account = gateway.state().accounts.find((a) => a.id === id);
    expect(account?.metadata).toEqual({ fetivi_host_id: hostA.id });
  });

  it('stores the card status on refresh, without the raw account id', async () => {
    const accountId = (await storedAccount(hostA.id)) as string;
    gateway.setCardStatus(accountId, 'active');
    t.clock.advance(60_000);
    const response = await post(t.app, REFRESH, undefined, hostA.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      stripeConnected: true,
      stripeCardPayments: 'active',
      stripeCheckedAt: t.clock.now().toISOString(),
    });
    expect(JSON.stringify(response.json())).not.toContain(accountId);
    expect((await get(t.app, '/api/host/payments', hostA.cookie)).json().stripeCardPayments).toBe(
      'active',
    );
  });

  it('gives another host their own account; refresh before onboarding is 409', async () => {
    const refresh = await post(t.app, REFRESH, undefined, hostB.cookie);
    expect(refresh.statusCode).toBe(409);
    expect(refresh.json()).toEqual({ error: 'no-account' });
    expect((await post(t.app, LINK, undefined, hostB.cookie)).statusCode).toBe(200);
    const b = await storedAccount(hostB.id);
    expect(b).toBeTruthy();
    expect(b).not.toBe(await storedAccount(hostA.id));
    expect((await get(t.app, '/api/host/payments', hostB.cookie)).json()).toMatchObject({
      stripeConnected: true,
      stripeCardPayments: null,
    });
  });

  it('is for hosts only', async () => {
    expect((await post(t.app, LINK)).statusCode).toBe(401);
    expect((await post(t.app, LINK, undefined, adminCookie)).statusCode).toBe(403);
  });

  it('answers 503 without a Stripe key', async () => {
    const other = await host(bare, 'c@example.test');
    expect((await post(bare.app, LINK, undefined, other.cookie)).statusCode).toBe(503);
    expect((await post(bare.app, REFRESH, undefined, other.cookie)).json()).toEqual({
      error: 'payments-not-configured',
    });
    expect((await get(bare.app, '/api/host/payments', other.cookie)).statusCode).toBe(200);
  });
});
