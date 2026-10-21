// Text extraction from an uploaded house manual. The parsers load lazily, so the processes that
// import @fetivi/domain but never read manuals (chat, jobs, MCP) never load pdf.js.
import { stripMarkdownHtml } from '../sanitize';

export const MANUAL_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
} as const;
export type ManualContentType = keyof typeof MANUAL_TYPES;
export type ManualFileType = (typeof MANUAL_TYPES)[ManualContentType];
export const MANUAL_CONTENT_TYPES = Object.keys(MANUAL_TYPES) as ManualContentType[];

export type SniffedManual = 'pdf' | 'zip' | 'text';

/** The sniffed kind each declared file type must have. */
export const SNIFFED_AS: Record<ManualFileType, SniffedManual> = {
  pdf: 'pdf',
  docx: 'zip',
  txt: 'text',
};

const SNIFF_BYTES = 8 * 1024;

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

/** What the bytes are: a PDF, a zip (a DOCX candidate), text, or none of these. */
export function sniffManualType(bytes: Uint8Array): SniffedManual | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf'; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip'; // PK\x03\x04
  if (bytes.subarray(0, SNIFF_BYTES).includes(0)) return null;
  return 'text';
}

/** The file's text, or null when it cannot be read (corrupt, encrypted, not UTF-8, not a DOCX). */
export async function extractManualText(
  bytes: Uint8Array,
  type: ManualFileType,
): Promise<string | null> {
  try {
    switch (type) {
      case 'pdf': {
        const { extractText } = await import('unpdf');
        // pdf.js may detach the buffer it is given, so it gets a copy.
        const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
        return text;
      }
      case 'docx': {
        const mammoth = await import('mammoth');
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return value;
      }
      case 'txt':
        // The decoder strips a leading BOM.
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
  } catch {
    return null;
  }
}

/** Markup removed and blank-line runs collapsed: what the length checks and the model see. */
export function normalizeManualText(text: string): string {
  return stripMarkdownHtml(text).replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
}
