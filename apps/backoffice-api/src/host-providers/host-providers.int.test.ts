import { accounts, curationItems, destinations, listGuestOffers, properties } from '@fetivi/domain';
import {
  publishOffer,
  type SeededGuestUnit,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  get,
  loginAs,
  post,
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let guest: SeededGuestUnit;
let destinationId: string;
let providerId: string;
let offerId: string;

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
}

const guestScope = () => ({ destinationId, propertyId: guest.propertyId, language: 'en' as const });

async function guestSees(id: string) {
  const offers = await listGuestOffers(t.db, guestScope(), {});
  return offers.some((o: { id: string }) => o.id === id);
}

beforeAll(async () => {
  t = await createTestApp();
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
  // Host A's guest is in a destination with one Provider's published Offer.
  guest = await seedGuestUnit(t.db, { now: t.clock.now() });
  await t.db
    .update(properties)
    .set({ hostId: hostA.id })
    .where(eq(properties.id, guest.propertyId));
  destinationId = await seedDestination(t.db);
  const provider = await seedProvider(t.db);
  providerId = provider.id;
  ({ offerId } = await seedOrderableOffer(t.db, {
    providerId,
    destinationId,
    availabilityMode: 'on_request',
  }));
  await publishOffer(t.db, offerId);
});

afterAll(async () => {
  await t?.close();
});

describe('host providers', () => {
  it('lists the Providers near the host, with their destinations', async () => {
    const response = await get(t.app, '/api/host/providers', hostA.cookie);
    expect(response.statusCode).toBe(200);
    const [destination] = await t.db
      .select({ name: destinations.name })
      .from(destinations)
      .where(eq(destinations.id, destinationId));
    const body = response.json();
    expect(body.destinations).toContainEqual({ id: destinationId, name: destination?.name });
    const listed = body.providers.find((p: { id: string }) => p.id === providerId);
    expect(listed).toMatchObject({ offerCount: 1, hidden: false });
    expect(listed).not.toHaveProperty('email');
    expect(listed).not.toHaveProperty('commissionBp');
    // Host B has no property, so nothing near them.
    expect((await get(t.app, '/api/host/providers', hostB.cookie)).json()).toEqual({
      providers: [],
      destinations: [],
    });
  });

  it("hiding stops the host's guests seeing the Provider's Offers; showing brings them back", async () => {
    expect(await guestSees(offerId)).toBe(true);
    const url = `/api/host/providers/${providerId}/hidden`;
    const hidden = await put(t.app, url, { hidden: true }, hostA.cookie);
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json()).toMatchObject({ id: providerId, hidden: true });
    expect((await put(t.app, url, { hidden: true }, hostA.cookie)).statusCode).toBe(200);
    expect(await guestSees(offerId)).toBe(false);
    const listed = (await get(t.app, '/api/host/providers', hostA.cookie)).json().providers;
    expect(listed.find((p: { id: string }) => p.id === providerId).hidden).toBe(true);

    expect((await put(t.app, url, { hidden: false }, hostA.cookie)).json().hidden).toBe(false);
    expect(await guestSees(offerId)).toBe(true);
  });

  it('a Provider not near the host cannot be hidden; a bad body is 400', async () => {
    const url = `/api/host/providers/${providerId}/hidden`;
    expect((await put(t.app, url, { hidden: true }, hostB.cookie)).statusCode).toBe(404);
    expect((await put(t.app, url, { hidden: 'yes' }, hostA.cookie)).statusCode).toBe(400);
    expect((await put(t.app, url, { hidden: true, x: 1 }, hostA.cookie)).statusCode).toBe(400);
  });
});

describe('provider suggestions', () => {
  it('puts one open host_provider_suggestion on the curation queue', async () => {
    const response = await post(
      t.app,
      '/api/host/provider-suggestions',
      {
        name: 'Konoba <b>Trs</b>',
        contact: '+385 21 000 000',
        note: 'Best fish in town.',
        destinationId,
      },
      hostA.cookie,
    );
    expect(response.statusCode).toBe(201);
    const { id } = response.json();
    const [item] = await t.db.select().from(curationItems).where(eq(curationItems.id, id));
    expect(item).toMatchObject({
      kind: 'host_provider_suggestion',
      status: 'open',
      hostId: hostA.id,
      destinationId,
      payload: {
        kind: 'host_provider_suggestion',
        name: 'Konoba Trs',
        contact: '+385 21 000 000',
        note: 'Best fish in town.',
      },
    });
  });

  it('takes a name alone', async () => {
    const response = await post(
      t.app,
      '/api/host/provider-suggestions',
      { name: 'Mare Boats' },
      hostB.cookie,
    );
    expect(response.statusCode).toBe(201);
    const [item] = await t.db
      .select()
      .from(curationItems)
      .where(eq(curationItems.id, response.json().id));
    expect(item).toMatchObject({
      hostId: hostB.id,
      destinationId: null,
      payload: { name: 'Mare Boats', contact: null, note: null },
    });
  });

  it.each([
    ['an extra key', { name: 'X', hostId: '00000000-0000-4000-8000-000000000000' }],
    ['no name', { contact: 'x' }],
    ['a name too long', { name: 'x'.repeat(121) }],
  ])('refuses %s', async (_, body) => {
    const response = await post(t.app, '/api/host/provider-suggestions', body, hostA.cookie);
    expect(response.statusCode).toBe(400);
  });

  it("refuses a destination the host's guests are not in", async () => {
    const response = await post(
      t.app,
      '/api/host/provider-suggestions',
      { name: 'X', destinationId },
      hostB.cookie,
    );
    expect(response.statusCode).toBe(400);
  });
});
