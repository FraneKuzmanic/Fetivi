import { z } from 'zod';

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().default('postgres://fetivi:fetivi@127.0.0.1:5433/fetivi'),
  /** The origin the back-office SPA is served from; write requests must carry it. */
  WEB_ORIGIN: z.url().default('http://localhost:5174'),
  /** The guest app's origin; units' QR codes link to it. */
  GUEST_ORIGIN: z.url().default('http://localhost:5173'),
  MAIL_TRANSPORT: z.enum(['console']).default('console'),
  /** Set behind Caddy (e.g. 'loopback') so login throttling sees the real client address. */
  TRUST_PROXY: z.string().optional(),
  /** Block media files. Both processes must point at the same directory (a shared volume in production). */
  MEDIA_DIR: z.string().default('../../.data/media'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
