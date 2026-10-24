import { randomUUID } from 'node:crypto';
import {
  accounts,
  appendTurn,
  getOrCreateConversation,
  hashToken,
  loadGuestProjection,
  newToken,
  properties,
  registerStay,
  spaces,
  suggestionText,
} from '@fetivi/domain';
import { type SeededGuestUnit, seedGuestUnit } from '@fetivi/domain/testing';
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

// The host's content-gap Suggestions over HTTP (44): Fetivi's sentence and a wizard link, never
// what guests wrote (AC 4), and never another host's.

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;
let guest: SeededGuestUnit;
const marker = randomUUID();
const DAY = 86_400_000;

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
}

/** A further Stay of the unit, with its own space. */
async function secondStay(unitId: string, now: Date) {
  const day = (n: number) => new Date(now.getTime() + n * DAY).toISOString().slice(0, 10);
  const stay = await registerStay(
    t.db,
    unitId,
    { checkIn: day(5), checkout: day(7), partySize: 2, bookerName: null, reservationNumber: null },
    now,
  );
  const [space] = await t.db
    .insert(spaces)
    .values({
      stayId: stay.id,
      tokenHash: hashToken(newToken()),
      language: 'en',
      closedAt: new Date(now.getTime() + 30 * DAY),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!space) throw new Error('no space');
  return { stayId: stay.id, spaceId: space.id };
}

/** A guest asks about laundry with the marker; Fetivi has no answer and notes the gap. */
async function gapTurn(stayId: string, spaceId: string, now: Date) {
  const projection = await loadGuestProjection(t.db, {
    unitId: guest.unitId,
    stayId,
    language: 'en',
    now,
  });
  const conversation = await getOrCreateConversation(
    t.db,
    spaceId,
    { systemPrompt: 's', projection },
    now,
  );
  await appendTurn(t.db, {
    conversationId: conversation.id,
    messages: [
      { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: `Washer? ${marker}` }] },
      {
        id: randomUUID(),
        role: 'assistant',
        parts: [
          { type: 'text', text: `I don't have that information. ${marker}` },
          {
            type: 'tool-note_missing_info',
            toolCallId: randomUUID(),
            state: 'output-available',
            input: { topic: 'laundry', note: marker },
            output: { noted: true },
          },
        ],
      },
    ],
    projection,
    situationNote: null,
    aboutMeNote: null,
    now,
  });
}

beforeAll(async () => {
  t = await createTestApp();
  const created = await createAdmin(t.db, 'admin@example.test', PASSWORD);
  if (!created.ok) throw new Error('admin not created');
  adminCookie = await loginAs(t, 'admin@example.test');
  hostA = await host('a@example.test');
  hostB = await host('b@example.test');
  const now = t.clock.now();
  guest = await seedGuestUnit(t.db, { now, checkInInDays: 0 });
  await t.db
    .update(properties)
    .set({ hostId: hostA.id })
    .where(eq(properties.id, guest.propertyId));

  await gapTurn(guest.stayId, guest.spaceId, now);
  const second = await secondStay(guest.unitId, now);
  await gapTurn(second.stayId, second.spaceId, now);
});

afterAll(async () => {
  await t?.close();
});

const url = '/api/host/suggestions';

describe('GET /api/host/suggestions', () => {
  it("gives the host Fetivi's sentence and the wizard link, never guest wording (AC 4)", async () => {
    const response = await get(t.app, url, hostA.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      suggestions: [
        {
          id: expect.any(String),
          unitId: guest.unitId,
          unitName: guest.unitName,
          propertyName: expect.any(String),
          topic: 'laundry',
          stayCount: 2,
          text: suggestionText('en', 'laundry', 2),
          wizardPath: `/units/${guest.unitId}/setup/how_tos#field-laundry`,
          createdAt: expect.any(String),
        },
      ],
    });
    expect(response.body).not.toContain(marker);
    expect(response.body).not.toContain(guest.pin);
  });

  it("never gives another host's Suggestions", async () => {
    const response = await get(t.app, url, hostB.cookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ suggestions: [] });
  });

  it('needs a host session, and act-as for an admin', async () => {
    expect((await get(t.app, url)).statusCode).toBe(401);
    expect((await get(t.app, url, adminCookie)).statusCode).toBe(403);
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      const acting = await get(t.app, url, adminCookie);
      expect(acting.statusCode).toBe(200);
      expect(acting.json().suggestions).toHaveLength(1);
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
  });
});
