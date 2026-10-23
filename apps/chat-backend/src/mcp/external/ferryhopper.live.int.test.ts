import { describe, expect, it } from 'vitest';
import { egress } from '../../egress';
import { createFerryhopper } from './ferryhopper';
import { FERRYHOPPER_PINNED_TOOLS } from './pin';

// Ferryhopper's real server through the real egress. Opt-in only:
// FETIVI_LIVE_TESTS=1 pnpm vitest run --project integration apps/chat-backend/src/mcp/external/ferryhopper.live.int.test.ts
const live = process.env.FETIVI_LIVE_TESTS === '1';
const PICKER = 'ui://widgets/ferry-trips-picker.html';

describe.skipIf(!live)('live Ferryhopper', () => {
  const ferryhopper = createFerryhopper({
    url: 'https://mcp.ferryhopper.com/mcp',
    fetch: egress.fetch,
    log: { info: () => {}, warn: () => {} },
    timeoutMs: 15_000,
  });

  it('lists the five pinned tools, answers get_ports and serves the picker widget', async () => {
    const listed = await ferryhopper.list();
    expect(listed.map((l) => l.tool.name)).toEqual([...FERRYHOPPER_PINNED_TOOLS]);
    const ports = await ferryhopper.call('get_ports', {}, 'model');
    expect(ports.isError).not.toBe(true);
    const widget = await ferryhopper.readWidget(PICKER);
    expect(widget.html.length).toBeGreaterThan(100_000);
    expect(widget.csp?.connectDomains?.length).toBeGreaterThan(0);
  }, 60_000);
});
