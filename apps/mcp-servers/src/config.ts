import { z } from 'zod';

const schema = z.object({
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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
