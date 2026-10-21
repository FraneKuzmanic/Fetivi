import { describe, expect, it } from 'vitest';
import { scrubSecrets } from './scrub';

describe('scrubSecrets', () => {
  it('replaces a password in the title and the body', () => {
    const [block] = scrubSecrets(
      [{ title: 'Wi-Fi sunce2024', body: 'The password is sunce2024, enjoy.' }],
      ['sunce2024'],
    );
    expect(block).toEqual({
      title: 'Wi-Fi ***',
      body: 'The password is ***, enjoy.',
      scrubbed: true,
    });
  });

  it('matches a phone number written with other spacing', () => {
    const [block] = scrubSecrets(
      [{ title: 'Contact', body: 'Call +385-91-2345678 or (091) 234 5678.' }],
      ['+385 91 234 5678'],
    );
    expect(block?.body).toBe('Call *** or (091) 234 5678.');
    expect(block?.scrubbed).toBe(true);
  });

  it('is case-sensitive for passwords', () => {
    const [block] = scrubSecrets([{ title: 't', body: 'SUNCE2024' }], ['sunce2024']);
    expect(block?.scrubbed).toBe(false);
  });

  it('ignores values under four characters and nulls', () => {
    const [block] = scrubSecrets([{ title: 'Room 12', body: 'Code 123 is old.' }], ['123', null]);
    expect(block).toEqual({ title: 'Room 12', body: 'Code 123 is old.', scrubbed: false });
  });

  it('leaves a block without secrets unchanged', () => {
    const input = { title: 'Beach', body: 'Pantan is 15 minutes away.', category: 'host_picks' };
    expect(scrubSecrets([input], ['4821#'])).toEqual([{ ...input, scrubbed: false }]);
  });

  it('treats a keypad code with # as a literal', () => {
    const [block] = scrubSecrets([{ title: 't', body: 'Type 4821# and push.' }], ['4821#']);
    expect(block?.body).toBe('Type *** and push.');
  });
});
