import {
  MCP_SERVERS,
  type McpServerName,
  SCOPES,
  serverUrl,
  UNIT_RESOURCE_URI,
} from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contextOf,
  createTestServer,
  mcpPost,
  signToken,
  TEST_BASE,
  type TestServer,
} from '../testing';

let t: TestServer;

beforeAll(async () => {
  t = await createTestServer({ listen: true });
});

afterAll(async () => {
  await t?.close();
});

const now = () => Math.floor(Date.now() / 1000);
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'legacy-client', version: '1' },
  },
};

async function seed(options: Parameters<typeof seedGuestUnit>[1] = {}) {
  const s = await seedGuestUnit(t.db, { now: new Date(), ...options });
  return { ...s, ctx: await contextOf(t.db, s.spaceId) };
}

async function connect(server: McpServerName, token: string) {
  const client = new Client(
    { name: 'test-client', version: '0' },
    { versionNegotiation: { mode: 'auto' } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${t.url}/${server}`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

const metadataUrl = (server: McpServerName) =>
  `${TEST_BASE}/.well-known/oauth-protected-resource/${server}`;

describe('bearer gate', () => {
  it('rejects a token for any other audience on every server', async () => {
    const { ctx } = await seed();
    for (const path of MCP_SERVERS) {
      const audiences = [
        ...MCP_SERVERS.filter((s) => s !== path).map((s) => serverUrl(TEST_BASE, s)),
        `https://evil.example/${path}`,
      ];
      for (const aud of audiences) {
        const token = await signToken(t.keys, { server: path, ctx, aud });
        const response = await mcpPost(t.app, `/${path}`, token, initialize);
        expect(response.statusCode, `${path} with aud ${aud}`).toBe(401);
        const challenge = String(response.headers['www-authenticate']);
        expect(challenge).toContain('Bearer');
        expect(challenge).toContain('invalid_token');
        expect(challenge).toContain(`resource_metadata="${metadataUrl(path)}"`);
      }
    }
  });

  it('rejects a missing or expired token on every server', async () => {
    const { ctx } = await seed();
    for (const path of MCP_SERVERS) {
      const missing = await mcpPost(t.app, `/${path}`, null, initialize);
      expect(missing.statusCode).toBe(401);
      expect(String(missing.headers['www-authenticate'])).toContain(metadataUrl(path));

      const expired = await signToken(t.keys, {
        server: path,
        ctx,
        iat: now() - 600,
        exp: now() - 1,
      });
      const response = await mcpPost(t.app, `/${path}`, expired, initialize);
      expect(response.statusCode).toBe(401);
      expect(String(response.headers['www-authenticate'])).toContain('invalid_token');
    }
  });

  it('answers 403 insufficient_scope for a stay token without unit:read', async () => {
    const { ctx } = await seed();
    const token = await signToken(t.keys, { server: 'stay', ctx, scope: 'host_message:send' });
    const response = await mcpPost(t.app, '/stay', token, initialize);
    expect(response.statusCode).toBe(403);
    const challenge = String(response.headers['www-authenticate']);
    expect(challenge).toContain('insufficient_scope');
    expect(challenge).toContain(metadataUrl('stay'));
  });

  it('refuses an unknown Host header', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/stay',
      headers: { host: 'evil.example.com', 'content-type': 'application/json' },
      payload: JSON.stringify(initialize),
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('protected resource metadata', () => {
  it('publishes an RFC 9728 document per server', async () => {
    for (const server of MCP_SERVERS) {
      const response = await t.app.inject({
        method: 'GET',
        url: `/.well-known/oauth-protected-resource/${server}`,
        headers: { host: '127.0.0.1' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        resource: `${TEST_BASE}/${server}`,
        resource_name: `Fetivi ${server}`,
        scopes_supported: [...SCOPES[server]],
        bearer_methods_supported: ['header'],
      });
    }
  });
});

describe('servers over HTTP', () => {
  it('serves an empty tool list on services and the About me tools on trip', async () => {
    const { ctx } = await seed();
    const expected = { services: [], trip: ['get_about_me', 'update_about_me'] };
    for (const server of ['services', 'trip'] as const) {
      const client = await connect(server, await signToken(t.keys, { server, ctx }));
      expect(client.getProtocolEra()).toBe('modern');
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(expected[server]);
      await client.close();
    }
  });

  it('serves the unit resource from the token, never another Stay', async () => {
    const a = await seed();
    const b = await seed();
    const client = await connect('stay', await signToken(t.keys, { server: 'stay', ctx: a.ctx }));
    expect((await client.listTools()).tools).toEqual([]);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual([UNIT_RESOURCE_URI]);

    const read = await client.readResource({ uri: UNIT_RESOURCE_URI });
    const text = JSON.stringify(read.contents);
    expect(text).toContain(a.unitName);
    expect(text).not.toContain(b.unitName);
    for (const value of Object.values(b.secrets)) expect(text).not.toContain(value);
    await client.close();

    const clientB = await connect('stay', await signToken(t.keys, { server: 'stay', ctx: b.ctx }));
    expect(
      JSON.stringify((await clientB.readResource({ uri: UNIT_RESOURCE_URI })).contents),
    ).toContain(b.unitName);
    await clientB.close();
  });

  it("gives a forged token with Stay A and B's unit no data", async () => {
    const a = await seed();
    const b = await seed();
    const token = await signToken(t.keys, {
      server: 'stay',
      ctx: a.ctx,
      claims: { unit: b.unitId, property: b.propertyId },
    });
    const client = await connect('stay', token);
    await expect(client.readResource({ uri: UNIT_RESOURCE_URI })).rejects.toThrow(/not found/i);
    await client.close();
  });

  it('holds codes back until the release time and shows them after', async () => {
    // Check-in in 2 days; released 1 day before → not yet; 7 days before → already.
    const early = await seed({ releaseDaysBefore: 1 });
    const client = await connect(
      'stay',
      await signToken(t.keys, { server: 'stay', ctx: early.ctx }),
    );
    const before = JSON.stringify((await client.readResource({ uri: UNIT_RESOURCE_URI })).contents);
    for (const value of Object.values(early.secrets)) expect(before).not.toContain(value);
    expect(before).not.toContain(early.afterReleaseTitle('en'));
    await client.close();

    const released = await seed({ releaseDaysBefore: 7, spaceLanguage: 'fr' });
    const clientR = await connect(
      'stay',
      await signToken(t.keys, { server: 'stay', ctx: released.ctx }),
    );
    const after = JSON.stringify((await clientR.readResource({ uri: UNIT_RESOURCE_URI })).contents);
    for (const value of Object.values(released.secrets)) {
      expect(after).toContain(JSON.stringify(value).slice(1, -1));
    }
    expect(after).toContain(released.afterReleaseTitle('fr'));
    await clientR.close();
  });

  it('serves the legacy initialize path', async () => {
    const { ctx } = await seed();
    const token = await signToken(t.keys, { server: 'stay', ctx });
    const response = await mcpPost(t.app, '/stay', token, initialize);
    expect(response.statusCode).toBe(200);
    const body = response.headers['content-type']?.toString().includes('text/event-stream')
      ? JSON.parse(
          response.body
            .split('\n')
            .find((l) => l.startsWith('data: '))
            ?.slice(6) ?? '{}',
        )
      : response.json();
    expect(body.result.serverInfo).toMatchObject({ name: 'fetivi-stay' });
  });
});
