import { z } from 'zod';

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
