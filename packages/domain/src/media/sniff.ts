import type { MediaContentType } from '../property/vocabulary';

const at = (bytes: Uint8Array, offset: number, signature: readonly number[]) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * The media type the bytes actually are, by file signature, or null for anything not accepted.
 * The declared content type and the file name are never trusted.
 */
export function sniffMediaType(bytes: Uint8Array): MediaContentType | null {
  if (at(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(bytes, 0, ascii('RIFF')) && at(bytes, 8, ascii('WEBP'))) return 'image/webp';
  if (at(bytes, 4, ascii('ftyp'))) return 'video/mp4';
  if (at(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  return null;
}
