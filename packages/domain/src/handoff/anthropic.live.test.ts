import { createEgress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { createAnthropicHandoffTranslator } from './translate';

// One short real Sonnet 5.5 call. Opt-in only:
// FETIVI_LIVE_TESTS=1 node --env-file=.env ./node_modules/vitest/vitest.mjs run --project integration packages/domain/src/handoff/anthropic.live.test.ts
const live = process.env.FETIVI_LIVE_TESTS === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

describe.skipIf(!live)('Anthropic handoff translator (live)', () => {
  it('translates Croatian into German and keeps the door code and the time', async () => {
    const translator = createAnthropicHandoffTranslator({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: createEgress({ allowlist: ['api.anthropic.com'] }).fetch,
    });
    const result = await translator.translate({
      text: 'Kod 4821 na vratima ne radi. Stižemo opet u 18:30.',
      to: 'de',
    });
    if (!result.ok) throw new Error(`${result.error}: ${result.detail}`);
    expect(result.text).toContain('4821');
    expect(result.text).toContain('18:30');
  }, 60_000);
});
