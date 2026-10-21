import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { UNIT_RESOURCE_URI } from '@fetivi/domain';
import { seedGuestUnit } from '@fetivi/domain/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextOf, createTestServer, signToken, type TestServer } from './testing';

// MCP Inspector CLI smoke test of /stay: conformance against the official tool, in `pnpm validate`.

const run = promisify(execFile);
let t: TestServer;
let home: string;
let inspectorBin: string;
let token: string;
let unitName: string;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@modelcontextprotocol/inspector/package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { bin: Record<string, string> };
  const bin = pkg.bin['mcp-inspector'];
  if (!bin) throw new Error('no mcp-inspector bin');
  inspectorBin = join(dirname(pkgPath), bin);

  home = await mkdtemp(join(tmpdir(), 'fetivi-inspector-'));
  t = await createTestServer({ listen: true });
  const seed = await seedGuestUnit(t.db, { now: new Date() });
  unitName = seed.unitName;
  token = await signToken(t.keys, { server: 'stay', ctx: await contextOf(t.db, seed.spaceId) });
});

afterAll(async () => {
  await t?.close();
  if (home) await rm(home, { recursive: true, force: true });
});

/** Runs the CLI with its own home, so it never touches the developer's config or keychain. */
async function inspector(...args: string[]): Promise<unknown> {
  const { stdout } = await run(
    process.execPath,
    [
      inspectorBin,
      '--cli',
      '--server-url',
      `${t.url}/stay`,
      '--transport',
      'http',
      '--header',
      `Authorization: Bearer ${token}`,
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
  );
  return JSON.parse(stdout);
}

describe('MCP Inspector CLI against /stay', () => {
  it('lists no tools', async () => {
    expect(await inspector('--method', 'tools/list')).toMatchObject({ tools: [] });
  }, 60_000);

  it('lists the unit resource', async () => {
    const out = (await inspector('--method', 'resources/list')) as { resources: { uri: string }[] };
    expect(out.resources.map((r) => r.uri)).toEqual([UNIT_RESOURCE_URI]);
  }, 60_000);

  it('reads the unit resource', async () => {
    const out = await inspector('--method', 'resources/read', '--uri', UNIT_RESOURCE_URI);
    expect(JSON.stringify(out)).toContain(unitName);
  }, 60_000);
});
