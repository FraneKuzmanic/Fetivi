// The parser lives in the domain, so kept transcripts resolve markers the same way.
export {
  type CitedSegment,
  citesAny,
  parseCitations,
  uncitedText,
} from '@fetivi/domain/citations';

/** A site's short name for its badge: 'www.visittrogir.hr' → 'visittrogir', 'split.gov.hr' → 'split'. */
export function siteName(host: string): string {
  const labels = host.replace(/^www\./, '').split('.');
  return labels[0] || host;
}
