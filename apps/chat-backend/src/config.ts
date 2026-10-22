import { TOOL_TRANSPORTS } from '@fetivi/domain';
import { z } from 'zod';

const DEV_REQUEST_STATE_SECRET = 'dev-only-request-state-secret-change-me-in-production';

const schema = z
  .object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().default('postgres://fetivi:fetivi@127.0.0.1:5433/fetivi'),
    /** The origin the guest SPA is served from; write requests must carry it. */
    APP_ORIGIN: z.url().default('http://localhost:5173'),
    /** Set behind Caddy (e.g. 'loopback') so PIN throttling sees the real client address. */
    TRUST_PROXY: z.string().optional(),
    NODE_ENV: z.string().optional(),
    /** PKCS8 PEM of the P-256 key guest tokens are signed with; required in production. */
    GUEST_TOKEN_PRIVATE_KEY: z.string().optional(),
    /** The `iss` of guest tokens. */
    GUEST_TOKEN_ISSUER: z.url().default('http://localhost:3000'),
    /** Base of the MCP servers' canonical URLs, the token audiences (production https://mcp.<domain>). */
    MCP_PUBLIC_URL: z.url().default('http://localhost:3002'),
    /** Claude for the guest chat; without it /api/chat answers 503. */
    ANTHROPIC_API_KEY: z.string().optional(),
    /** How the chat reaches the guest tools: MCP (production) or in process (V0, evaluation only). */
    TOOL_TRANSPORT: z.enum(TOOL_TRANSPORTS).default('mcp'),
    /**
     * Read only with TOOL_TRANSPORT=inprocess: the confirmation `requestState` key. It must equal
     * the MCP servers' REQUEST_STATE_SECRET (the same dev default).
     */
    REQUEST_STATE_SECRET: z.string().min(32).default(DEV_REQUEST_STATE_SECRET),
    /** Block media files. Both processes must point at the same directory (a shared volume in production). */
    MEDIA_DIR: z.string().default('../../.data/media'),
    /** Web push (VAPID) public key, the jobs process's pair; without it push is never offered. */
    VAPID_PUBLIC_KEY: z
      .string()
      .optional()
      .transform((s) => s || undefined),
  })
  .refine((c) => c.NODE_ENV !== 'production' || Boolean(c.GUEST_TOKEN_PRIVATE_KEY), {
    message: 'GUEST_TOKEN_PRIVATE_KEY is required in production',
    path: ['GUEST_TOKEN_PRIVATE_KEY'],
  })
  // MCP is the production path: the in-process mode skips the token boundary.
  .refine((c) => c.NODE_ENV !== 'production' || c.TOOL_TRANSPORT === 'mcp', {
    message: 'TOOL_TRANSPORT must be mcp in production',
    path: ['TOOL_TRANSPORT'],
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
