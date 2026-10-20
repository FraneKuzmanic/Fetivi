import { createEgress } from '@fetivi/egress';
import { describe, expect, it } from 'vitest';
import { GUEST_LANGUAGES } from '../property/vocabulary';
import { createAnthropicTranslationModel } from './model';
import { checkStructure } from './structure';

// One real Sonnet 5.5 call, about $0.07. Opt-in only:
// FETIVI_LIVE_TESTS=1 ANTHROPIC_API_KEY=... pnpm vitest run packages/domain/src/translation/anthropic.live.test.ts
const live = process.env.FETIVI_LIVE_TESTS === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

const SOURCE = {
  title: 'Parkiranje i ulaz {{gate_code}}',
  body: [
    '## Parkiranje',
    '',
    'Parking je iza kuće, 10 minuta od centra Splita. Kod za rampu je {{gate_code}}.',
    '',
    '1. Skrenite desno nakon pekare.',
    '2. Unesite kod {{gate_code}} na rampi.',
    '3. Parkirajte na mjesto broj 4.',
    '',
    'Karta: [otvori kartu](https://maps.google.com/?q=43.5081,16.4402)',
    '',
    'Polako, pomalo, nema žurbe!',
  ].join('\n'),
};

describe.skipIf(!live)('Anthropic translation model (live)', () => {
  it('translates a Croatian block into all seven languages with the structure kept', async () => {
    const model = createAnthropicTranslationModel({
      apiKey: process.env.ANTHROPIC_API_KEY,
      fetch: createEgress({ allowlist: ['api.anthropic.com'] }).fetch,
    });
    const result = await model.translate(SOURCE);
    if (!result.ok) throw new Error(`${result.error}: ${result.detail}`);
    expect(result.output.source_language).toBe('hr');
    for (const language of GUEST_LANGUAGES.filter((l) => l !== 'hr')) {
      expect(checkStructure(SOURCE, result.output.translations[language]), language).toEqual([]);
    }
    const italian = result.output.translations.it.body;
    expect(italian).toContain('Split');
    expect(italian).not.toContain('Spalato');
  }, 180_000);
});
