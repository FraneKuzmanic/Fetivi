import type { Egress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { checkLlmKey, detectLlmProvider } from './llm-providers';

type Reply = { status: number; body?: unknown };

function fakeFetch(replies: Record<string, Reply>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, headers: (init?.headers ?? {}) as Record<string, string> });
    const reply = replies[new URL(u).host];
    if (!reply) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  }) as Egress['fetch'];
  return { fn, calls };
}

const ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
const OPENAI_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz';
const GOOGLE_KEY = 'AIzaSyAbcdefghijklmnopqrstuvwxyz012345';
const PLAIN_KEY = 'abcdefghijklmnopqrstuvwxyz012345';

describe('detectLlmProvider', () => {
  it('recognises a provider by its key prefix', () => {
    expect(detectLlmProvider(ANTHROPIC_KEY)).toBe('anthropic');
    expect(detectLlmProvider(OPENAI_KEY)).toBe('openai');
    expect(detectLlmProvider('sk-abcdefghijklmnopqrstuvwxyz')).toBe('openai');
    expect(detectLlmProvider(GOOGLE_KEY)).toBe('google');
  });

  it('gives null for a key with no distinctive prefix', () => {
    expect(detectLlmProvider(PLAIN_KEY)).toBeNull();
  });
});

describe('checkLlmKey', () => {
  it('lists the Anthropic models, sending the key in its header', async () => {
    const { fn, calls } = fakeFetch({
      'api.anthropic.com': {
        status: 200,
        body: { data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }] },
      },
    });
    expect(await checkLlmKey(ANTHROPIC_KEY, fn)).toEqual({
      ok: true,
      provider: 'anthropic',
      models: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
    });
    expect(calls[0]?.headers['x-api-key']).toBe(ANTHROPIC_KEY);
  });

  it('keeps only the OpenAI models that write text', async () => {
    const { fn, calls } = fakeFetch({
      'api.openai.com': {
        status: 200,
        body: {
          data: [
            { id: 'gpt-5' },
            { id: 'text-embedding-3-small' },
            { id: 'o4-mini' },
            { id: 'gpt-4o-realtime-preview' },
            { id: 'whisper-1' },
          ],
        },
      },
    });
    expect(await checkLlmKey(OPENAI_KEY, fn)).toEqual({
      ok: true,
      provider: 'openai',
      models: ['gpt-5', 'o4-mini'],
    });
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${OPENAI_KEY}`);
  });

  it('keeps only the Google models that generate content, never putting the key in the URL', async () => {
    const { fn, calls } = fakeFetch({
      'generativelanguage.googleapis.com': {
        status: 200,
        body: {
          models: [
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          ],
        },
      },
    });
    expect(await checkLlmKey(GOOGLE_KEY, fn)).toEqual({
      ok: true,
      provider: 'google',
      models: ['gemini-2.5-pro'],
    });
    expect(calls[0]?.url).not.toContain('AIza');
  });

  it('tries Mistral for a key with no known prefix, keeping its chat models', async () => {
    const { fn } = fakeFetch({
      'api.mistral.ai': {
        status: 200,
        body: {
          data: [
            { id: 'mistral-large-latest', capabilities: { completion_chat: true } },
            { id: 'mistral-embed', capabilities: { completion_chat: false } },
          ],
        },
      },
    });
    expect(await checkLlmKey(PLAIN_KEY, fn)).toEqual({
      ok: true,
      provider: 'mistral',
      models: ['mistral-large-latest'],
    });
  });

  it('calls a key no provider accepts unrecognised', async () => {
    const { fn } = fakeFetch({ 'api.mistral.ai': { status: 401 } });
    expect(await checkLlmKey(PLAIN_KEY, fn)).toEqual({ ok: false, error: 'unrecognised' });
  });

  it('reports a rejected key, an unreachable provider and a missing key', async () => {
    const rejected = fakeFetch({ 'api.anthropic.com': { status: 401 } });
    expect(await checkLlmKey(ANTHROPIC_KEY, rejected.fn)).toEqual({ ok: false, error: 'rejected' });
    const down = fakeFetch({ 'api.openai.com': { status: 503 } });
    expect(await checkLlmKey(OPENAI_KEY, down.fn)).toEqual({ ok: false, error: 'unreachable' });
    const offline = fakeFetch({});
    expect(await checkLlmKey(OPENAI_KEY, offline.fn)).toEqual({ ok: false, error: 'unreachable' });
    expect(await checkLlmKey(undefined, offline.fn)).toEqual({
      ok: false,
      error: 'not-configured',
    });
  });
});
