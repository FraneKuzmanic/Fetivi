import { GUEST_LANGUAGES, infoBlocks, QUEUES, uuidFrom } from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  get,
  loginAs,
  patch,
  post,
  put,
  signUpVerifiedHost,
  type TestApp,
} from '../testing';

let t: TestApp;
let hostA: string;
let hostB: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'a@example.test');
  await signUpVerifiedHost(t, 'b@example.test');
  hostA = await loginAs(t, 'a@example.test');
  hostB = await loginAs(t, 'b@example.test');
});

afterAll(async () => {
  await t?.close();
});

interface Block {
  id: string;
  revision: number;
  translation: { status: string; error: string | null; publishedRevision: number | null };
}

async function newBlock(): Promise<{ propertyId: string; block: Block }> {
  const p = await post(t.app, '/api/host/properties', { name: 'Villa' }, hostA);
  const propertyId = p.json().id as string;
  const r = await post(
    t.app,
    `/api/host/properties/${propertyId}/blocks`,
    { category: 'how_tos', title: 'Rubbish', body: 'Bins are by the gate.' },
    hostA,
  );
  expect(r.statusCode).toBe(201);
  return { propertyId, block: r.json().block };
}

const jobsFor = async (blockId: string) =>
  (await t.boss.findJobs<{ blockId: string; revision: number }>(QUEUES.translateBlock)).filter(
    (j) => j.data.blockId === blockId,
  );

const setFailed = (id: string) =>
  t.db
    .update(infoBlocks)
    .set({ translationStatus: 'failed', translationError: 'model-error' })
    .where(eq(infoBlocks.id, id));

describe('translation on save', () => {
  it('enqueues one job keyed by block id and revision on create', async () => {
    const { block } = await newBlock();
    const jobs = await jobsFor(block.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(uuidFrom(`translate:${block.id}:1`));
    expect(jobs[0]?.data).toEqual({ blockId: block.id, revision: 1 });
    expect(block.translation).toEqual({
      status: 'pending',
      error: null,
      publishedRevision: null,
      sourceLanguage: null,
    });
  });

  it('keeps the revision and sends no job when the text does not change', async () => {
    const { block } = await newBlock();
    const url = `/api/host/blocks/${block.id}`;
    for (const changes of [
      { visibility: 'after_release' },
      { category: 'arrival_access' },
      { position: 3 },
      { title: 'Rubbish', body: 'Bins are by the gate.' },
    ]) {
      const r = await patch(t.app, url, changes, hostA);
      expect(r.statusCode).toBe(200);
      expect(r.json().block.revision).toBe(1);
    }
    expect(await jobsFor(block.id)).toHaveLength(1);
  });

  it('bumps the revision and enqueues when the body changes', async () => {
    const { block } = await newBlock();
    await setFailed(block.id);
    const r = await patch(t.app, `/api/host/blocks/${block.id}`, { body: 'New text.' }, hostA);
    expect(r.json().block).toMatchObject({
      revision: 2,
      translation: { status: 'pending', error: null },
    });
    const jobs = await jobsFor(block.id);
    expect(jobs.map((j) => j.data.revision).sort()).toEqual([1, 2]);
  });

  it('shows the translation summary on property detail blocks', async () => {
    const { propertyId } = await newBlock();
    const r = await get(t.app, `/api/host/properties/${propertyId}`, hostA);
    expect(r.json().blocks[0].translation.status).toBe('pending');
  });
});

describe('translation routes', () => {
  it('lists seven empty languages for a new block', async () => {
    const { block } = await newBlock();
    const r = await get(t.app, `/api/host/blocks/${block.id}/translations`, hostA);
    expect(r.statusCode).toBe(200);
    const view = r.json();
    expect(view.languages.map((l: { language: string }) => l.language)).toEqual([
      ...GUEST_LANGUAGES,
    ]);
    expect(view.languages.every((l: { current: unknown }) => l.current === null)).toBe(true);
  });

  it('answers 404 to another host on every route', async () => {
    const { block } = await newBlock();
    const base = `/api/host/blocks/${block.id}/translations`;
    expect((await get(t.app, base, hostB)).statusCode).toBe(404);
    const body = { revision: 1, title: 'T', body: 'B' };
    expect((await put(t.app, `${base}/de`, body, hostB)).statusCode).toBe(404);
    expect((await post(t.app, `${base}/retry`, undefined, hostB)).statusCode).toBe(404);
  });

  it('saves a correction and rejects a bad language or a stale revision', async () => {
    const { block } = await newBlock();
    const base = `/api/host/blocks/${block.id}/translations`;
    const ok = await put(
      t.app,
      `${base}/de`,
      { revision: 1, title: 'Müll', body: 'Tonnen.' },
      hostA,
    );
    expect(ok.statusCode).toBe(200);
    const de = ok.json().view.languages.find((l: { language: string }) => l.language === 'de');
    expect(de.current).toMatchObject({ title: 'Müll', origin: 'host' });
    expect(ok.json().structureWarnings).toEqual([]);

    const bad = await put(t.app, `${base}/es`, { revision: 1, title: 'x', body: 'y' }, hostA);
    expect(bad.statusCode).toBe(400);
    const stale = await put(t.app, `${base}/de`, { revision: 5, title: 'x', body: 'y' }, hostA);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'stale-revision' });
  });

  it('retries only a failed translation', async () => {
    const { block } = await newBlock();
    const url = `/api/host/blocks/${block.id}/translations/retry`;
    const pending = await post(t.app, url, undefined, hostA);
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toEqual({ error: 'translation-not-failed' });

    await setFailed(block.id);
    const retried = await post(t.app, url, undefined, hostA);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().view.status).toBe('pending');
    expect(await jobsFor(block.id)).toHaveLength(2);
  });
});
