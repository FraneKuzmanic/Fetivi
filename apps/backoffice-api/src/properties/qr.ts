import QRCode from 'qrcode';

export type QrFormat = 'svg' | 'png';

/** The permanent guest link a unit's QR code encodes. */
export function unitLink(guestOrigin: string, slug: string): string {
  return new URL(`/u/${slug}`, guestOrigin).toString();
}

export async function renderQr(url: string, format: QrFormat) {
  const options = { errorCorrectionLevel: 'M', margin: 2 } as const;
  if (format === 'svg') {
    return {
      body: await QRCode.toString(url, { ...options, type: 'svg' }),
      contentType: 'image/svg+xml',
    };
  }
  return {
    body: await QRCode.toBuffer(url, { ...options, type: 'png', width: 1024 }),
    contentType: 'image/png',
  };
}

/** A file name for the download, e.g. "fetivi-apartment-1-qr.png". */
export function qrFileName(unitName: string, format: QrFormat): string {
  const slug =
    unitName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'unit';
  return `fetivi-${slug}-qr.${format}`;
}
