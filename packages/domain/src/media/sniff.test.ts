import { describe, expect, it } from 'vitest';
import { sniffMediaType } from './sniff';

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe('sniffMediaType', () => {
  it.each([
    ['image/jpeg', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])],
    ['image/png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    ['image/webp', bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 ')],
    ['video/mp4', bytes([0, 0, 0, 0x20], 'ftypisom')],
    ['video/webm', bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f])],
  ])('detects %s', (type, data) => {
    expect(sniffMediaType(data)).toBe(type);
  });

  it.each([
    ['text', bytes('hello world, this is text')],
    ['GIF', bytes('GIF89a', [0, 0, 0, 0])],
    ['empty', new Uint8Array()],
    ['RIFF that is not WebP', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt ')],
    ['truncated PNG', bytes([0x89, 0x50, 0x4e])],
  ])('rejects %s', (_name, data) => {
    expect(sniffMediaType(data)).toBeNull();
  });

  it('reports the true type, whatever was declared', () => {
    // The caller compares this with the declared content type.
    expect(sniffMediaType(bytes([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
  });
});
