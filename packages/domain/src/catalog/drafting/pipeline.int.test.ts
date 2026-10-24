import { createEgress } from '@fetivi/egress';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enqueueCurationItem } from '../../curation/store';
import { type CurationPayload, isDrafted } from '../../curation/vocabulary';
import { accounts } from '../../db/schema/accounts';
import { catalogOpeningHours, placeOpenDataSources } from '../../db/schema/catalog';
import { curationItems } from '../../db/schema/curation';
import { draftingTasks } from '../../db/schema/drafting';
import { seedingCandidates } from '../../db/schema/seeding';
import { createTestDatabase, noopQueue, seedDestination, type TestDatabase } from '../../testing';
import { createCatalogRecord, markVerified, replaceOpeningHours } from '../store';
import { commonsImageUrl } from './commons';
import type { DraftingModelResult } from './model';
import { type DraftingDeps, draftCandidateTask, refreshRecordTask } from './pipeline';
import { buildDraftingMessage, type DraftingInput } from './prompt';
import { startDraftingRun, startRefreshRun } from './runs';
import type { DraftExtractionData } from './schema';
import {
  EMPTY_EXTRACTION,
  type RecordedAnswer,
  recordedPagesFetch,
  scriptedDraftingModel,
} from './testing';

const NOW = new Date('2027-04-01T09:00:00Z');
const LATER = new Date('2027-04-01T09:01:00Z');
const VENUE = 'https://www.svdominik.com/';
const CONTACT = `${VENUE}contact/`;
const INJECTION = 'https://injekcija.hr/';
const COMMONS_FILE = 'File:Fortress Kamerlengo 14.jpg';
const OSM_POINT = { x: 16.2512, y: 43.5168 };
const OVERTURE_POINT = { x: 16.2513, y: 43.5169 };

const VENUE_PAGES: Record<string, RecordedAnswer> = {
  [VENUE]: { file: 'konoba-venue.html' },
  [CONTACT]: { file: 'konoba-contact.html' },
};

let testDb: TestDatabase;
let adminId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const [admin] = await testDb.db
    .insert(accounts)
    .values({ email: 'pipeline@example.test', passwordHash: 'x', role: 'admin' })
    .returning();
  if (!admin) throw new Error('no admin');
  adminId = admin.id;
});

afterAll(async () => {
  await testDb?.drop();
});

afterEach(() => vi.unstubAllGlobals());

type Script = (input: DraftingInput) => DraftExtractionData | DraftingModelResult;

/** The real per-task egress over a recorded global fetch; the Commons fetch answers on its own. */
function deps(pages: Record<string, RecordedAnswer>, script: Script) {
  const recorded = recordedPagesFetch(pages);
  vi.stubGlobal('fetch', recorded);
  const allowlists: (readonly string[])[] = [];
  const commons = recordedPagesFetch({
    [commonsImageUrl(COMMONS_FILE)]: {
      file: 'commons-imageinfo.json',
      contentType: 'application/json',
    },
  });
  const model = scriptedDraftingModel(script);
  const value: DraftingDeps = {
    db: testDb.db,
    model,
    fetchFor: (allowlist) => {
      allowlists.push(allowlist);
      return createEgress({ allowlist }).fetch;
    },
    commonsFetch: commons,
    userAgent: 'Fetivi/test',
  };
  return { deps: value, recorded, commons, model, allowlists };
}

interface CandidateOptions {
  osmTags?: Record<string, string>;
  overture?: boolean;
}

/** A ticked candidate with its rows and draft item, and a queued drafting task for it. */
async function queuedCandidate({ osmTags = {}, overture = true }: CandidateOptions = {}) {
  const destinationId = await seedDestination(testDb.db);
  const [candidate] = await testDb.db
    .insert(seedingCandidates)
    .values({ destinationId, status: 'ticked', createdAt: NOW, updatedAt: NOW })
    .returning();
  if (!candidate) throw new Error('no candidate');
  const row = {
    destinationId,
    candidateId: candidate.id,
    placeCategory: 'restaurant' as const,
    fetchedAt: NOW,
  };
  await testDb.db.insert(placeOpenDataSources).values([
    {
      ...row,
      source: 'osm',
      externalId: 'node/1',
      licence: 'ODbL-1.0',
      name: 'Sv. Dominik',
      location: OSM_POINT,
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      data: { tags: { amenity: 'restaurant', ...osmTags } },
    },
    ...(overture
      ? [
          {
            ...row,
            source: 'overture' as const,
            externalId: 'ov-1',
            licence: 'CDLA-Permissive-2.0',
            name: 'Restoran Sv. Dominik',
            location: OVERTURE_POINT,
            sourceUrl: null,
            data: { websites: [], socials: [] },
          },
        ]
      : []),
  ]);
  const item = await enqueueCurationItem(
    testDb.db,
    {
      destinationId,
      dedupeKey: `seeding-candidate:${candidate.id}`,
      payload: { kind: 'draft', changes: {}, candidateId: candidate.id },
    },
    NOW,
  );
  const run = await testDb.db.transaction((tx) =>
    startDraftingRun(tx, noopQueue, destinationId, adminId, NOW),
  );
  const [task] = await testDb.db
    .select()
    .from(draftingTasks)
    .where(eq(draftingTasks.runId, run.runId ?? ''));
  if (!task) throw new Error('no task');
  return { destinationId, candidateId: candidate.id, itemId: item.id, taskId: task.id };
}

async function itemPayload(itemId: string) {
  const [item] = await testDb.db.select().from(curationItems).where(eq(curationItems.id, itemId));
  return item?.payload as Extract<CurationPayload, { kind: 'draft' }>;
}

async function taskRow(taskId: string) {
  const [task] = await testDb.db.select().from(draftingTasks).where(eq(draftingTasks.id, taskId));
  return task;
}

const sourced = <T>(value: T, sourceUrl: string) => ({ value, sourceUrl });

const venueDraft: Script = () => ({
  ...EMPTY_EXTRACTION,
  title: sourced('Restoran Sv. Dominik', VENUE),
  description: sourced('A restaurant in a <b>Dominican</b> courtyard in Trogir.', VENUE),
  openingHours: sourced(
    [1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      opens: '15:00',
      closes: '23:00',
      validFrom: null,
      validTo: null,
    })),
    CONTACT,
  ),
  // Cites a page that was never fetched, so it is dropped.
  phone: sourced('+385 21 000 111', 'https://www.svdominik.com/never-fetched/'),
});

describe('draftCandidateTask', () => {
  it('drafts a candidate from its own site, with a source per field and a Commons image', async () => {
    const { itemId, taskId } = await queuedCandidate({
      osmTags: { website: VENUE, wikimedia_commons: 'File:Fortress_Kamerlengo_14.jpg' },
    });
    const { deps: d, recorded, model, allowlists } = deps(VENUE_PAGES, venueDraft);

    const summary = await draftCandidateTask(d, taskId, LATER);

    expect(summary).toEqual({ status: 'drafted', pages: 2, fields: 3 });
    const payload = await itemPayload(itemId);
    expect(isDrafted(payload)).toBe(true);
    expect(payload.changes.title).toBe('Restoran Sv. Dominik');
    expect(payload.changes.description).toBe('A restaurant in a Dominican courtyard in Trogir.');
    expect(payload.changes.phone).toBeUndefined();
    expect(payload.changes.openingHours).toHaveLength(6);
    expect(payload.changes.fieldSources).toEqual({
      title: VENUE,
      description: VENUE,
      openingHours: CONTACT,
    });
    // Overture before OSM: the permissive licence wins the location; OSM's tags the category.
    expect(payload.place).toEqual({
      placeCategory: 'restaurant',
      categorySourceUrl: 'https://www.openstreetmap.org/node/1',
      location: { lat: OVERTURE_POINT.y, lng: OVERTURE_POINT.x },
      locationSource: 'overture',
      locationSourceUrl: null,
    });
    expect(payload.images).toEqual([
      expect.objectContaining({
        url: expect.stringMatching(/^https:\/\/upload\.wikimedia\.org\//),
        licence: 'CC BY-SA 4.0',
        attribution: expect.stringContaining('Bergier'),
        sourcePageUrl: expect.stringMatching(/^https:\/\/commons\.wikimedia\.org\//),
      }),
    ]);
    expect(payload.drafting).toEqual({
      status: 'drafted',
      at: LATER.toISOString(),
      pages: [VENUE, CONTACT],
    });
    expect(await taskRow(taskId)).toMatchObject({ status: 'drafted', failure: null });

    // The model saw only the two recorded pages, wrapped as data.
    expect(model.inputs).toHaveLength(1);
    const [input] = model.inputs;
    if (!input) throw new Error('no input');
    expect(input.pages.map((p) => p.url)).toEqual([VENUE, CONTACT]);
    const message = buildDraftingMessage(input);
    expect(message).toContain(`<page url="${VENUE}">`);
    expect(message).toContain(`<page url="${CONTACT}">`);
    expect(allowlists).toEqual([['svdominik.com', 'www.svdominik.com']]);
    expect(recorded.requests.every((u) => new URL(u).hostname === 'www.svdominik.com')).toBe(true);
  });

  it('takes the OSM point, with its URL, when no other row has one', async () => {
    const { itemId, taskId } = await queuedCandidate({
      osmTags: { website: VENUE },
      overture: false,
    });
    const { deps: d } = deps(VENUE_PAGES, venueDraft);
    await draftCandidateTask(d, taskId, LATER);
    const payload = await itemPayload(itemId);
    expect(payload.place).toEqual({
      placeCategory: 'restaurant',
      categorySourceUrl: 'https://www.openstreetmap.org/node/1',
      location: { lat: OSM_POINT.y, lng: OSM_POINT.x },
      locationSource: 'osm',
      locationSourceUrl: 'https://www.openstreetmap.org/node/1',
    });
    expect(payload.images).toEqual([]);
  });

  it('ends as no_sources without calling the model when there is no URL', async () => {
    const { itemId, taskId } = await queuedCandidate();
    const { deps: d, model, recorded } = deps({}, venueDraft);
    expect(await draftCandidateTask(d, taskId, LATER)).toEqual({
      status: 'no_sources',
      pages: 0,
      fields: 0,
    });
    expect(model.inputs).toEqual([]);
    expect(recorded.requests).toEqual([]);
    const payload = await itemPayload(itemId);
    expect(payload.drafting).toEqual({ status: 'no_sources', at: LATER.toISOString(), pages: [] });
    expect(isDrafted(payload)).toBe(false);
  });

  it('records fetch-failed when the only site redirects off its host', async () => {
    const { taskId } = await queuedCandidate({ osmTags: { website: VENUE } });
    const { deps: d, recorded } = deps(
      { [VENUE]: { redirect: 'https://evil.example/' } },
      venueDraft,
    );
    expect((await draftCandidateTask(d, taskId, LATER)).status).toBe('no_sources');
    expect(await taskRow(taskId)).toMatchObject({ status: 'no_sources', failure: 'fetch-failed' });
    expect(recorded.requests).toEqual([VENUE]);
  });

  it('ends as failed on a model error, and the item stays Reject-only', async () => {
    const { itemId, taskId } = await queuedCandidate({ osmTags: { website: VENUE } });
    const { deps: d } = deps(VENUE_PAGES, () => ({
      ok: false,
      error: 'model-error',
      detail: 'APIError 529',
    }));
    expect((await draftCandidateTask(d, taskId, LATER)).status).toBe('failed');
    expect(await taskRow(taskId)).toMatchObject({ status: 'failed', failure: 'model-error' });
    const payload = await itemPayload(itemId);
    expect(payload.drafting?.status).toBe('failed');
    expect(payload.changes).toEqual({});
    expect(isDrafted(payload)).toBe(false);
  });

  it('ends as no_sources when no fetched page gives the title', async () => {
    const { itemId, taskId } = await queuedCandidate({ osmTags: { website: VENUE } });
    const { deps: d } = deps(VENUE_PAGES, () => ({
      ...EMPTY_EXTRACTION,
      // The candidate's own name, cited to a page the task never read.
      title: sourced('Sv. Dominik', 'https://www.openstreetmap.org/node/1'),
    }));
    expect((await draftCandidateTask(d, taskId, LATER)).status).toBe('no_sources');
    expect((await itemPayload(itemId)).drafting?.status).toBe('no_sources');
  });

  it('keeps an injection page to its own host and its values to plain text', async () => {
    const { itemId, taskId } = await queuedCandidate({ osmTags: { website: INJECTION } });
    const {
      deps: d,
      recorded,
      model,
    } = deps({ [INJECTION]: { file: 'injection-venue.html' } }, () => ({
      ...EMPTY_EXTRACTION,
      title: sourced('Konoba <i>Injekcija</i>', INJECTION),
      phone: sourced(' +385 21 000 000 ', INJECTION),
    }));
    expect((await draftCandidateTask(d, taskId, LATER)).status).toBe('drafted');
    const payload = await itemPayload(itemId);
    expect(payload.changes.title).toBe('Konoba Injekcija');
    expect(payload.changes.phone).toBe('+385 21 000 000');
    expect(recorded.requests.every((u) => new URL(u).hostname === 'injekcija.hr')).toBe(true);
    expect(model.inputs[0]?.pages[0]?.text).not.toContain('never read me');
  });

  it('notes a permanent closure atop the description, naming the page that said so', async () => {
    const { itemId, taskId } = await queuedCandidate({ osmTags: { website: VENUE } });
    const { deps: d } = deps(
      VENUE_PAGES,
      (input) =>
        ({
          ...venueDraft(input),
          permanentlyClosed: { sourceUrl: CONTACT },
        }) as DraftExtractionData,
    );
    await draftCandidateTask(d, taskId, LATER);
    const payload = await itemPayload(itemId);
    expect(payload.changes.description).toMatch(
      new RegExp(`^Permanently closed according to ${CONTACT}\\.\\n\\n`),
    );
    expect(payload.changes.fieldSources?.description).toBe(VENUE);
  });

  it('does nothing on a duplicate job, and nothing for an item rejected meanwhile', async () => {
    const first = await queuedCandidate({ osmTags: { website: VENUE } });
    const { deps: d, model } = deps(VENUE_PAGES, venueDraft);
    await draftCandidateTask(d, first.taskId, LATER);
    expect(await draftCandidateTask(d, first.taskId, LATER)).toEqual({
      status: 'skipped',
      pages: 0,
      fields: 0,
    });
    expect(model.inputs).toHaveLength(1);

    const second = await queuedCandidate({ osmTags: { website: VENUE } });
    await testDb.db
      .update(curationItems)
      .set({ status: 'rejected' })
      .where(eq(curationItems.id, second.itemId));
    expect((await draftCandidateTask(d, second.taskId, LATER)).status).toBe('failed');
    expect(await taskRow(second.taskId)).toMatchObject({
      status: 'failed',
      failure: 'record-gone',
    });
    expect((await itemPayload(second.itemId)).drafting).toBeUndefined();
    expect(model.inputs).toHaveLength(1);
  });
});

describe('refreshRecordTask', () => {
  const HOURS = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    opens: '15:00',
    closes: '23:00',
    validFrom: null,
    validTo: null,
  }));

  async function queuedRefresh(hours = HOURS) {
    const destinationId = await seedDestination(testDb.db);
    const record = await createCatalogRecord(
      testDb.db,
      noopQueue,
      {
        destinationId,
        kind: 'place',
        title: 'Restoran Sv. Dominik',
        description: 'The admin wrote this.',
        placeCategory: 'restaurant',
        location: OSM_POINT,
        websiteUrl: VENUE,
        fieldSources: { title: VENUE },
      },
      NOW,
    );
    await replaceOpeningHours(testDb.db, record.id, hours, NOW);
    await markVerified(testDb.db, record.id, adminId, new Date('2026-06-01T00:00:00Z'));
    const run = await startRefreshRun(testDb.db, noopQueue, destinationId, adminId, NOW);
    const [task] = await testDb.db
      .select()
      .from(draftingTasks)
      .where(eq(draftingTasks.runId, run.runId ?? ''));
    if (!task) throw new Error('no task');
    return { recordId: record.id, runId: run.runId, taskId: task.id };
  }

  const refreshDiffs = (recordId: string) =>
    testDb.db
      .select()
      .from(curationItems)
      .where(and(eq(curationItems.recordId, recordId), eq(curationItems.kind, 'refresh_diff')));

  it('queues one refresh diff with the changed hours and their previous value', async () => {
    const { recordId, runId, taskId } = await queuedRefresh(
      HOURS.map((h) => ({ ...h, opens: '12:00' })),
    );
    const { deps: d } = deps(VENUE_PAGES, venueDraft);
    expect(await draftCandidateTask(d, taskId, LATER)).toEqual({
      status: 'skipped',
      pages: 0,
      fields: 0,
    });
    expect((await refreshRecordTask(d, taskId, LATER)).status).toBe('diffed');
    const items = await refreshDiffs(recordId);
    expect(items).toHaveLength(1);
    const payload = items[0]?.payload as Extract<CurationPayload, { kind: 'refresh_diff' }>;
    expect(items[0]?.dedupeKey).toBe(`refresh:${recordId}:${runId}`);
    expect(payload.runId).toBe(runId);
    // The description is never compared; the title is unchanged.
    expect(Object.keys(payload.changes).sort()).toEqual(['fieldSources', 'openingHours']);
    expect(payload.changes.openingHours).toEqual(HOURS);
    expect(payload.changes.fieldSources).toEqual({ openingHours: CONTACT });
    expect(payload.previous.openingHours).toEqual(HOURS.map((h) => ({ ...h, opens: '12:00' })));
    expect(await taskRow(taskId)).toMatchObject({ status: 'diffed' });
  });

  it('queues nothing when the facts are the same', async () => {
    const { recordId, taskId } = await queuedRefresh();
    const { deps: d } = deps(VENUE_PAGES, venueDraft);
    expect((await refreshRecordTask(d, taskId, LATER)).status).toBe('unchanged');
    expect(await refreshDiffs(recordId)).toEqual([]);
    const hours = await testDb.db
      .select()
      .from(catalogOpeningHours)
      .where(eq(catalogOpeningHours.recordId, recordId));
    expect(hours).toHaveLength(6);
  });
});
