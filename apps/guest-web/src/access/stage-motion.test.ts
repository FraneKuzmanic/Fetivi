import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// happy-dom applies no cascade, so this reads the stylesheet: the global reduced-motion reset
// (`* { animation: none }`) has no specificity and loses to `.stage-speech`, which needs its own.
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

describe('the onboarding balloon under reduced motion', () => {
  it('turns its entrance and bob off after the rule that starts them', () => {
    const animated = css.indexOf('speech-bob 2.8s');
    const optOut = css.search(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.stage-speech \{\s*animation: none;/,
    );
    expect(animated).toBeGreaterThan(-1);
    expect(optOut).toBeGreaterThan(animated);
  });
});
