import type { McpUiResourceCsp } from '@modelcontextprotocol/ext-apps/app-bridge';

/** The sandbox proxy page, on its own origin (`sandbox.` in production, port 5174 in dev). */
export const SANDBOX_URL: string =
  import.meta.env.VITE_SANDBOX_URL ?? 'http://localhost:5174/sandbox.html';

/** The proxy page's URL; the proxy turns `csp` into the page's Content-Security-Policy header. */
export function sandboxUrl(csp?: McpUiResourceCsp): string {
  const url = new URL(SANDBOX_URL);
  if (csp) url.searchParams.set('csp', JSON.stringify(csp));
  return url.href;
}
