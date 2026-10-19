import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('sends the method and a JSON body', async () => {
    const fetchMock = stubFetch(Response.json({ ok: true }));
    await expect(api('/api/x', { method: 'POST', body: { a: 1 } })).resolves.toEqual({ ok: true });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(init?.credentials).toBe('same-origin');
  });

  it('resolves a 204 to undefined', async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api('/api/x', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws an ApiError with the server code', async () => {
    stubFetch(Response.json({ error: 'stop-acting-first' }, { status: 403 }));
    const error = await api('/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'stop-acting-first' });
  });

  it('maps a non-JSON error body to internal', async () => {
    stubFetch(new Response('Bad gateway', { status: 502 }));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 502, code: 'internal' });
  });
});
