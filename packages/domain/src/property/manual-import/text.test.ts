import { describe, expect, it } from 'vitest';
import { minimalDocx, minimalPdf, plainZip } from './fixtures';
import { extractManualText, normalizeManualText, sniffManualType } from './text';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('sniffManualType', () => {
  it('recognises PDF, zip and text', () => {
    expect(sniffManualType(bytes('%PDF-1.4\n'))).toBe('pdf');
    expect(sniffManualType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe('zip');
    expect(sniffManualType(bytes('Welcome to Apartman Mare'))).toBe('text');
  });

  it('rejects binary content with a NUL byte', () => {
    expect(sniffManualType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]))).toBeNull();
  });
});

describe('extractManualText', () => {
  it('reads UTF-8 text and drops the BOM', async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('Dobrodošli u Trogir')]);
    expect(await extractManualText(withBom, 'txt')).toBe('Dobrodošli u Trogir');
  });

  it('rejects invalid UTF-8', async () => {
    expect(await extractManualText(new Uint8Array([0x48, 0xc3, 0x28]), 'txt')).toBeNull();
  });

  it('reads the paragraphs of a DOCX', async () => {
    const docx = await minimalDocx(['Check-in is from 15:00.', 'Checkout is by 10:00.']);
    const text = await extractManualText(docx, 'docx');
    expect(text).toContain('Check-in is from 15:00.');
    expect(text).toContain('Checkout is by 10:00.');
  });

  it('rejects a zip that is not a DOCX', async () => {
    expect(await extractManualText(await plainZip(), 'docx')).toBeNull();
  });

  it('reads the text of a PDF', async () => {
    const text = await extractManualText(minimalPdf('Quiet hours from 22:00'), 'pdf');
    expect(text).toContain('Quiet hours from 22:00');
  });

  it('rejects a corrupt PDF', async () => {
    expect(await extractManualText(bytes('%PDF-1.4\nnot really a pdf'), 'pdf')).toBeNull();
  });
});

describe('normalizeManualText', () => {
  it('strips markup and collapses runs of blank lines', () => {
    expect(normalizeManualText('<b>Hi</b>\n\n\n\n  \nThere<script>x</script>')).toBe('Hi\n\nThere');
  });
});
