import { z } from 'zod';

const DEV_REQUEST_STATE_SECRET = 'dev-only-request-state-secret-change-me-in-production';

const schema = z
  .object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    DATABASE_URL: z.string().default('postgres://fetivi:fetivi@127.0.0.1:5433/fetivi'),
    // Host headers the server accepts; production sets the mcp. origin.
    MCP_ALLOWED_HOSTS: z
      .string()
      .default('localhost,127.0.0.1')
      .transform((value) =>
        value
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      ),
    /** Base of the servers' canonical URLs (token audiences); production https://mcp.<domain>. */
    MCP_PUBLIC_URL: z.url().default('http://localhost:3002'),
    /** The `iss` guest tokens must carry: the chat backend. */
    GUEST_TOKEN_ISSUER: z.url().default('http://localhost:3000'),
    /** The chat backend's JWKS; production https://app.<domain>/.well-known/jwks.json. */
    GUEST_TOKEN_JWKS_URL: z.url().default('http://127.0.0.1:3000/.well-known/jwks.json'),
    NODE_ENV: z.string().optional(),
    /** Seals the elicitation `requestState` (HMAC); the same in every instance; required in production. */
    REQUEST_STATE_SECRET: z.string().min(32).default(DEV_REQUEST_STATE_SECRET),
    /** MET Norway requires an identifying agent with contact details; production sets a reachable one. */
    WEATHER_USER_AGENT: z
      .string()
      .min(10)
      .default('Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)'),
    /** Brave Search for web_fallback_search; without it the tool answers "not available". */
    BRAVE_SEARCH_API_KEY: z
      .string()
      .optional()
      .transform((s) => s || undefined),
  })
  .refine(
    (c) => c.NODE_ENV !== 'production' || c.REQUEST_STATE_SECRET !== DEV_REQUEST_STATE_SECRET,
    {
      message: 'REQUEST_STATE_SECRET is required in production',
      path: ['REQUEST_STATE_SECRET'],
    },
  );

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
