import { describe, expect, it } from 'vitest';
import { findSecretLikeText } from './secrets';

const kinds = (text: string) => findSecretLikeText(text).map((w) => w.kind);

describe('findSecretLikeText', () => {
  it.each([
    ['Door code is 4821', 'code'],
    ['Šifra: 1234#', 'code'],
    ['Press *2580# on the keypad', 'code'],
    ['call me on +385 91 234 5678', 'phone'],
    ['WiFi password: sunset2024', 'password'],
    ['Lozinka = more123', 'password'],
  ])('flags %j as %s', (text, kind) => {
    expect(kinds(text)).toContain(kind);
  });

  it.each([
    'Checkout by 10:00',
    'Bus 37 leaves every 20 minutes',
    'Built in 1923',
    '2 bedrooms, 1 bathroom',
    'The door is on the left, second floor.',
  ])('does not flag %j', (text) => {
    expect(findSecretLikeText(text)).toEqual([]);
  });

  it('keeps excerpts short', () => {
    const [warning] = findSecretLikeText(`Door code ${'x'.repeat(15)} 4821 ${'y'.repeat(60)}`);
    expect(warning?.excerpt.length).toBeLessThanOrEqual(40);
  });

  it('reports a repeated secret once', () => {
    expect(findSecretLikeText('code 4821. Again: code 4821')).toHaveLength(1);
  });
});
