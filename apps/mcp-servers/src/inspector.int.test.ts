import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fromLocalDateTime, type McpServerName, UNIT_RESOURCE_URI } from '@fetivi/domain';
import {
  publishOffer,
  seedDestination,
  seedGuestUnit,
  seedOrderableOffer,
  seedProvider,
} from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextOf, createTestServer, signToken, type TestServer } from './testing';

// MCP Inspector CLI smoke tests of /stay and /services: conformance against the official tool, in
// `pnpm validate`. The CLI connects in the legacy era and cannot answer a form, so create_order
// proves the S5 tool error there; the full elicitation round is a manual web-UI check.

const run = promisify(execFile);
let t: TestServer;
let home: string;
let inspectorBin: string;
let token: string;
let servicesToken: string;
let unitName: string;
let spaceId: string;
let offerId: string;
let day: string;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@modelcontextprotocol/inspector/package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { bin: Record<string, string> };
  const bin = pkg.bin['mcp-inspector'];
  if (!bin) throw new Error('no mcp-inspector bin');
  inspectorBin = join(dirname(pkgPath), bin);

  home = await mkdtemp(join(tmpdir(), 'fetivi-inspector-'));
  t = await createTestServer({ listen: true });
  const destinationId = await seedDestination(t.db);
  const seed = await seedGuestUnit(t.db, { now: new Date() });
  unitName = seed.unitName;
  spaceId = seed.spaceId;
  const ctx = await contextOf(t.db, seed.spaceId);
  token = await signToken(t.keys, { server: 'stay', ctx });
  servicesToken = await signToken(t.keys, { server: 'services', ctx });
  day = new Date(Date.parse(`${seed.stay.checkIn}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const provider = await seedProvider(t.db);
  ({ offerId } = await seedOrderableOffer(t.db, {
    providerId: provider.id,
    destinationId,
    availabilityMode: 'allotment',
    startsAt: fromLocalDateTime(`${day}T09:00`, 'Europe/Zagreb'),
  }));
  await publishOffer(t.db, offerId);
});

afterAll(async () => {
  await t?.close();
  if (home) await rm(home, { recursive: true, force: true });
});

/**
 * Runs the CLI with its own home, so it never touches the developer's config or keychain. A tool
 * error exits non-zero with the result on stdout, which is returned as well.
 */
async function inspector(
  server: McpServerName,
  bearer: string,
  ...args: string[]
): Promise<unknown> {
  const { stdout } = await run(
    process.execPath,
    [
      inspectorBin,
      '--cli',
      '--server-url',
      `${t.url}/${server}`,
      '--transport',
      'http',
      '--header',
      `Authorization: Bearer ${bearer}`,
      ...args,
    ],
    {
      timeout: 60_000,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        MCP_CATALOG_PATH: join(home, 'mcp.json'),
      },
    },
  ).catch((error: { stdout?: string }) => {
    if (!error.stdout?.trim()) throw error;
    return { stdout: error.stdout };
  });
  return JSON.parse(stdout);
}

describe('MCP Inspector CLI against /stay', () => {
  it('lists the Host message tools', async () => {
    const out = (await inspector('stay', token, '--method', 'tools/list')) as {
      tools: { name: string }[];
    };
    expect(out.tools.map((t) => t.name)).toEqual(['draft_host_message', 'send_host_message']);
  }, 60_000);

  it('lists the unit resource', async () => {
    const out = (await inspector('stay', token, '--method', 'resources/list')) as {
      resources: { uri: string }[];
    };
    expect(out.resources.map((r) => r.uri)).toEqual([UNIT_RESOURCE_URI]);
  }, 60_000);

  it('reads the unit resource', async () => {
    const out = await inspector(
      'stay',
      token,
      '--method',
      'resources/read',
      '--uri',
      UNIT_RESOURCE_URI,
    );
    expect(JSON.stringify(out)).toContain(unitName);
  }, 60_000);
});

describe('MCP Inspector CLI against /services', () => {
  const services = (...args: string[]) => inspector('services', servicesToken, ...args);

  it('lists the six tools in order, with annotations', async () => {
    const out = (await services('--method', 'tools/list')) as {
      tools: { name: string; annotations: { readOnlyHint: boolean } }[];
    };
    expect(out.tools.map((tool) => tool.name)).toEqual([
      'list_offers',
      'check_availability',
      'list_my_orders',
      'create_order',
      'cancel_order',
      'respond_to_order_update',
    ]);
    expect(out.tools.map((tool) => tool.annotations.readOnlyHint)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  }, 60_000);

  it('lists the Offer', async () => {
    const out = (await services('--method', 'tools/call', '--tool-name', 'list_offers')) as {
      structuredContent: { offers: { id: string }[] };
    };
    expect(out.structuredContent.offers.map((o) => o.id)).toEqual([offerId]);
  }, 60_000);

  it('answers create_order with a tool error and stores nothing', async () => {
    const out = (await services(
      '--method',
      'tools/call',
      '--tool-name',
      'create_order',
      '--tool-arg',
      `offerId=${offerId}`,
      `date=${day}`,
      'quantity=2',
    )) as { isError: boolean; content: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.content[0]?.text).toContain('cannot show a booking confirmation');
    const pending = await t.db.query.pendingActions.findMany({
      where: (p, { eq }) => eq(p.spaceId, spaceId),
    });
    expect(pending).toEqual([]);
  }, 60_000);
});
