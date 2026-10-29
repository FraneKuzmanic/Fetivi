import { describe, expect, it } from 'vitest';
import { EMBEDDING_MODEL, VOYAGE_ENDPOINT } from './vocabulary';
import { createVoyageEmbedder, EmbeddingUnavailableError, parseVoyageResponse } from './voyage';

function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  };
  return Object.assign(fetch, { calls });
}

function voyageBody(vectors: { embedding: number[]; index: number }[], tokens = 7) {
  return JSON.stringify({
    object: 'list',
    data: vectors.map((v) => ({ object: 'embedding', ...v })),
    model: EMBEDDING_MODEL,
    usage: { total_tokens: tokens },
  });
}

describe('createVoyageEmbedder', () => {
  it('posts the texts with the key and returns the vectors in input order', async () => {
    const fetch = stubFetch(
      () =>
        new Response(
          voyageBody([
            { embedding: [0, 1], index: 1 },
            { embedding: [1, 0], index: 0 },
          ]),
        ),
    );
    const embedder = createVoyageEmbedder({ fetch, apiKey: 'secret' });
    const result = await embedder.embed(['fresh fish', 'pizza'], 'query');

    expect(embedder.model).toBe(EMBEDDING_MODEL);
    expect(result).toEqual({
      vectors: [
        [1, 0],
        [0, 1],
      ],
      tokens: 7,
    });
    expect(fetch.calls).toHaveLength(1);
    const call = fetch.calls[0];
    expect(call?.url).toBe(VOYAGE_ENDPOINT);
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers).toMatchObject({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    });
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      input: ['fresh fish', 'pizza'],
      model: EMBEDDING_MODEL,
      input_type: 'query',
      truncation: true,
    });
  });

  it('is unavailable without a key and sends nothing', async () => {
    const fetch = stubFetch(() => new Response(voyageBody([])));
    const embedder = createVoyageEmbedder({ fetch, apiKey: undefined });
    await expect(embedder.embed(['fish'], 'query')).rejects.toThrow(/^no key$/);
    expect(fetch.calls).toHaveLength(0);
  });

  it('sends no request for no texts', async () => {
    const fetch = stubFetch(() => new Response(voyageBody([])));
    const result = await createVoyageEmbedder({ fetch, apiKey: 'secret' }).embed([], 'document');
    expect(result).toEqual({ vectors: [], tokens: 0 });
    expect(fetch.calls).toHaveLength(0);
  });

  it.each([
    ['a 500', () => new Response('down', { status: 500 })],
    ['a 429', () => new Response('slow down', { status: 429 })],
    ['a thrown fetch', () => Promise.reject(new Error('network'))],
    ['invalid JSON', () => new Response('<html>')],
    ['a malformed body', () => new Response(JSON.stringify({ data: [{ index: 0 }] }))],
    ['too few vectors', () => new Response(voyageBody([{ embedding: [1], index: 0 }]))],
  ])('is unavailable on %s', async (_, respond) => {
    const embedder = createVoyageEmbedder({ fetch: stubFetch(respond), apiKey: 'secret' });
    await expect(embedder.embed(['fish', 'pizza'], 'document')).rejects.toThrow(
      EmbeddingUnavailableError,
    );
  });

  it('keeps the key and texts out of the error', async () => {
    const embedder = createVoyageEmbedder({
      fetch: stubFetch(() => new Response('', { status: 401 })),
      apiKey: 'secret',
    });
    await expect(embedder.embed(['fresh fish'], 'query')).rejects.toThrow(/^status 401$/);
  });
});

describe('parseVoyageResponse', () => {
  it('rejects a count mismatch', () => {
    expect(() =>
      parseVoyageResponse(JSON.parse(voyageBody([{ embedding: [1], index: 0 }])), 2),
    ).toThrow(EmbeddingUnavailableError);
  });
});
