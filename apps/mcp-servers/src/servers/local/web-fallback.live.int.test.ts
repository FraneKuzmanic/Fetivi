import { createBraveSearch, FALLBACK_SITES } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { egress } from '../../egress';
import { contextOf, createTestServer, signToken, type TestServer } from '../../testing';
import { webFallbackOutput } from './schemas';

// One real Brave search through the real egress. Opt-in only (vitest does not load the root .env):
// FETIVI_LIVE_TESTS=1 node --env-file=.env ./node_modules/vitest/vitest.mjs run --project integration apps/mcp-servers/src/servers/local/web-fallback.live.int.test.ts
const apiKey = process.env.BRAVE_SEARCH_API_KEY;
const live = process.env.FETIVI_LIVE_TESTS === '1' && Boolean(apiKey);

describe.skipIf(!live)('live web_fallback_search (Brave)', () => {
  let t: TestServer;
  let token: string;

  beforeAll(async () => {
    t = await createTestServer({
      listen: true,
      webSearch: createBraveSearch({ fetch: egress.fetch, apiKey }),
    });
    // Outside any destination: the static allowlist only.
    const guest = await seedGuestUnit(t.db, { location: null });
    token = await signToken(t.keys, { server: 'local', ctx: await contextOf(t.db, guest.spaceId) });
  });

  afterAll(async () => {
    await t?.close();
  });

  it('answers only allowlisted https pages', async () => {
    const client = new Client(
      { name: 'test-client', version: '0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${t.url}/local`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    try {
      const result = await client.callTool({
        name: 'web_fallback_search',
        arguments: { keywords: 'kayak rental', place: 'Trogir' },
      });
      expect(result.isError).toBeFalsy();
      const { results } = webFallbackOutput.parse(result.structuredContent);
      for (const r of results) {
        const host = new URL(r.url).hostname;
        expect(r.url.startsWith('https://')).toBe(true);
        expect(FALLBACK_SITES.some((s) => host === s.host || host.endsWith(`.${s.host}`))).toBe(
          true,
        );
      }
    } finally {
      await client.close();
    }
  });
});
