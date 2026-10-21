import { describe, expect, it } from 'vitest';
import { openTurnClients } from './clients';

const unused = async () => {
  throw new Error('no network');
};
const clients = () =>
  openTurnClients({
    tokens: { stay: 'a', local: 'b', services: 'c', trip: 'd' },
    baseUrl: 'http://mcp.test',
    fetch: unused,
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('openTurnClients timing', () => {
  it('counts overlapping and nested calls once', async () => {
    const c = clients();
    const start = performance.now();
    await Promise.all([
      c.timed(() => wait(40)),
      c.timed(() => wait(40)),
      c.timed(() => c.timed(() => wait(40))),
    ]);
    const wall = performance.now() - start;
    expect(c.mcpMs).toBeGreaterThanOrEqual(35);
    expect(c.mcpMs).toBeLessThanOrEqual(wall + 1);
  });

  it('adds separate calls up', async () => {
    const c = clients();
    const start = performance.now();
    await c.timed(() => wait(20));
    const gapStart = performance.now();
    await wait(30);
    const gap = performance.now() - gapStart;
    await c.timed(() => wait(20));
    const wall = performance.now() - start;
    expect(c.mcpMs).toBeGreaterThanOrEqual(35);
    // The gap between the calls is not counted, however long the machine made it.
    expect(c.mcpMs).toBeLessThanOrEqual(wall - gap + 1);
  });
});
