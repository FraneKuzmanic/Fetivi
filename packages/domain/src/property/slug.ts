import { randomInt } from 'node:crypto';

/** No 0/o, 1/l: the slug may be read off a printed QR sticker. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export const QR_SLUG_LENGTH = 12;

/** A unit's permanent guest link slug: 12 characters, about 60 bits, unguessable. */
export function newQrSlug(): string {
  let slug = '';
  for (let i = 0; i < QR_SLUG_LENGTH; i++) slug += ALPHABET[randomInt(ALPHABET.length)];
  return slug;
}
