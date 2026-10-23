/**
 * Whether a widget may open this link: https on ferryhopper.com or one of its subdomains. The
 * URL opens unchanged, so Ferryhopper's own affiliate id stays as it is.
 */
export function isFerryhopperLink(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    (url.hostname === 'ferryhopper.com' || url.hostname.endsWith('.ferryhopper.com'))
  );
}
