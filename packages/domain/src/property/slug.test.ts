import { describe, expect, it } from 'vitest';
import { newQrSlug } from './slug';

describe('newQrSlug', () => {
  it('is 12 characters from the readable alphabet', () => {
    for (let i = 0; i < 100; i++) expect(newQrSlug()).toMatch(/^[a-km-np-z2-9]{12}$/);
  });

  it('does not repeat', () => {
    const slugs = new Set(Array.from({ length: 1000 }, newQrSlug));
    expect(slugs.size).toBe(1000);
  });
});
