/** The CSP an MCP App's resource declares (`_meta.ui.csp`, the ext-apps `McpUiResourceCsp` shape). */
export type ResourceCsp = {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
};

const KEYS = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'] as const;

// The spec's restrictive policy for a resource that declares no CSP.
const DEFAULT_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
];

/**
 * Drops entries that could escape their directive: `;` or a newline starts a new directive,
 * a quote injects a keyword such as 'unsafe-eval', a space adds a second source.
 */
export function sanitizeCspDomains(domains?: unknown): string[] {
  if (!Array.isArray(domains)) return [];
  return domains.filter(
    (d): d is string => typeof d === 'string' && d !== '' && !/[;\r\n'" ,]/.test(d),
  );
}

/** Reads `?csp=` (JSON from the host). Anything malformed counts as no declared CSP, so the strict default applies. */
export function parseCspParam(raw: string | null): ResourceCsp | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const csp: ResourceCsp = {};
  for (const key of KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (value !== undefined) csp[key] = sanitizeCspDomains(value);
  }
  return csp;
}

/** The sandbox page's Content-Security-Policy header, ported from the ext-apps basic host. */
export function buildCspHeader(csp: ResourceCsp | undefined, appOrigin: string): string {
  const frameAncestors = `frame-ancestors ${appOrigin}`;
  if (!csp)
    return [...DEFAULT_CSP, "object-src 'none'", "base-uri 'none'", frameAncestors].join('; ');
  const resources = sanitizeCspDomains(csp.resourceDomains).join(' ');
  const connect = sanitizeCspDomains(csp.connectDomains).join(' ');
  const frames = sanitizeCspDomains(csp.frameDomains).join(' ');
  const baseUris = sanitizeCspDomains(csp.baseUriDomains).join(' ');
  return [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resources}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resources}`.trim(),
    `img-src 'self' data: blob: ${resources}`.trim(),
    `font-src 'self' data: blob: ${resources}`.trim(),
    `media-src 'self' data: blob: ${resources}`.trim(),
    `connect-src 'self' ${connect}`.trim(),
    `worker-src 'self' blob: ${resources}`.trim(),
    frames ? `frame-src ${frames}` : "frame-src 'none'",
    "object-src 'none'",
    baseUris ? `base-uri ${baseUris}` : "base-uri 'none'",
    frameAncestors,
  ].join('; ');
}
