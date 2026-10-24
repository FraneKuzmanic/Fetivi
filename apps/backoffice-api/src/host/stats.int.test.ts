import { randomUUID } from 'node:crypto';
import {
  accounts,
  appendTurn,
  getOrCreateConversation,
  loadGuestProjection,
  properties,
  setAnswerFeedback,
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

// Host and admin answer stats over HTTP (43): counts only, and a host never sees another
// host's unit (AC 5).

let t: TestApp;
let hostA: { id: string; cookie: string };
let hostB: { id: string; cookie: string };
let adminCookie: string;
let guest: SeededGuestUnit;
const marker = randomUUID();

async function host(email: string) {
  await signUpVerifiedHost(t, email);
  const [row] = await t.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.email, email));
  if (!row) throw new Error(`no account ${email}`);
  return { id: row.id, cookie: await loginAs(t, email) };
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

  const projection = await loadGuestProjection(t.db, {
    unitId: guest.unitId,
    stayId: guest.stayId,
    language: 'en',
    now,
  });
  const conversation = await getOrCreateConversation(
    t.db,
    guest.spaceId,
    { systemPrompt: 's', projection },
    now,
  );
  const answerId = randomUUID();
  await appendTurn(t.db, {
    conversationId: conversation.id,
    messages: [
      { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: `Wifi? ${marker}` }] },
      {
        id: answerId,
        role: 'assistant',
        parts: [
          {
            type: 'tool-show_property_info',
            toolCallId: 'c1',
            state: 'output-available',
            input: { topic: 'wifi' },
            output: {},
          },
          { type: 'text', text: `The password is ${marker}` },
        ],
      },
    ],
    projection,
    situationNote: null,
    aboutMeNote: null,
    now,
  });
  await setAnswerFeedback(t.db, {
    spaceId: guest.spaceId,
    messageId: answerId,
    thumb: 'up',
    reason: null,
    now,
  });
});

afterAll(async () => {
  await t?.close();
});

const statsUrl = (unitId: string) => `/api/host/units/${unitId}/stats`;

describe('GET /api/host/units/:id/stats', () => {
  it("gives the host their unit's counts, never text or the PIN", async () => {
    const response = await get(t.app, statsUrl(guest.unitId), hostA.cookie);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.unit).toEqual({ id: guest.unitId, name: guest.unitName });
    expect(body.totals).toMatchObject({ conversations: 1, answers: 1, up: 1, down: 0 });
    expect(body.topTopics).toEqual([{ topic: 'wifi', count: 1 }]);
    expect(body.stays).toEqual([
      expect.objectContaining({ stayId: guest.stayId, conversations: 1, answers: 1, up: 1 }),
    ]);
    expect(response.body).not.toContain(marker);
    expect(response.body).not.toContain(guest.pin);
    expect(response.body).not.toContain(guest.private.reservationNumber);
  });

  it("reports another host's unit exactly like a missing one (AC 5)", async () => {
    const other = await get(t.app, statsUrl(guest.unitId), hostB.cookie);
    const missing = await get(t.app, statsUrl(randomUUID()), hostB.cookie);
    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual(missing.json());
    expect((await get(t.app, statsUrl('not-a-uuid'), hostA.cookie)).statusCode).toBe(400);
  });

  it('needs act-as for an admin', async () => {
    expect((await get(t.app, statsUrl(guest.unitId), adminCookie)).statusCode).toBe(403);
    await post(t.app, '/api/admin/act-as', { hostId: hostA.id }, adminCookie);
    try {
      expect((await get(t.app, statsUrl(guest.unitId), adminCookie)).statusCode).toBe(200);
    } finally {
      await post(t.app, '/api/admin/act-as/stop', undefined, adminCookie);
    }
  });
});

describe('GET /api/admin/feedback-stats', () => {
  it('gives the admin a row per unit, and is admin only', async () => {
    const response = await get(t.app, '/api/admin/feedback-stats', adminCookie);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totals).toMatchObject({ answers: 1, up: 1 });
    expect(body.units).toEqual([
      expect.objectContaining({
        unitId: guest.unitId,
        hostEmail: 'a@example.test',
        stays: 1,
        conversations: 1,
        answers: 1,
      }),
    ]);
    expect(response.body).not.toContain(marker);
    expect((await get(t.app, '/api/admin/feedback-stats', hostA.cookie)).statusCode).toBe(403);
  });
});
