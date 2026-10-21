import { createEgress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { createAnthropicManualImportModel } from './model';
import { SAMPLE_MANUAL } from './sample-manual';
import { SECRET_COLUMNS } from './schema';
import { scrubSecrets } from './scrub';

// One real Haiku 5.5 call, well under $0.01. Opt-in only:
// FETIVI_LIVE_TESTS=1 ANTHROPIC_API_KEY=... pnpm vitest run packages/domain/src/property/manual-import/anthropic.live.test.ts
const live = process.env.FETIVI_LIVE_TESTS === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!live)('Anthropic manual import model (live)', () => {
  it('maps the sample manual onto fields, typed blocks and unmapped content', async () => {
    const model = createAnthropicManualImportModel({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: createEgress({ allowlist: ['api.anthropic.com'] }).fetch,
    });
    const result = await model.extract(SAMPLE_MANUAL);
    if (!result.ok) throw new Error(`${result.error}: ${result.detail}`);
    const { fields, blocks, unmapped } = result.output;

    expect(fields.checkInTime).toBe('15:00');
    expect(fields.checkoutTime).toBe('10:00');
    expect(fields.wifiPassword).toBe('sunce2024');
    expect(fields.wifiNetwork).toBe('MareGuest');
    expect(fields.doorCode).toContain('4821');
    expect(fields.hostPhone).toContain('91 234');

    const scrubbed = scrubSecrets(
      blocks,
      SECRET_COLUMNS.map((c) => fields[c]),
    );
    for (const block of scrubbed) {
      expect(`${block.title}\n${block.body}`).not.toContain('sunce2024');
      expect(`${block.title}\n${block.body}`).not.toContain('4821');
    }
    expect(blocks.some((b) => b.category === 'how_tos')).toBe(true);
    // Public emergency numbers are not secrets and stay in the blocks.
    expect(blocks.map((b) => b.body).join('\n')).toContain('112');
    const everything = [...unmapped, ...blocks.map((b) => b.body)].join('\n');
    expect(everything).toContain('Mici');
  }, 180_000);
});
