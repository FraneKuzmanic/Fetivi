import { z } from 'zod';

const DEV_PROVIDER_LINK_SECRET = 'dev-only-provider-link-secret-change-me-in-production';

const schema = z
  .object({
    DATABASE_URL: z.string().default('postgres://fetivi:fetivi@127.0.0.1:5433/fetivi'),
    /** Without it, translations fail visibly as not-configured. */
    ANTHROPIC_API_KEY: z
      .string()
      .optional()
      .transform((s) => s || undefined),
    NODE_ENV: z.string().optional(),
    /** Derives the per-order Provider link tokens; required in production. */
    PROVIDER_LINK_SECRET: z.string().min(32).default(DEV_PROVIDER_LINK_SECRET),
    /** The back-office origin the Provider page is served from (production https://host.<domain>). */
    PROVIDER_LINK_BASE_URL: z.url().default('http://localhost:5174'),
  })
  .refine(
    (c) => c.NODE_ENV !== 'production' || c.PROVIDER_LINK_SECRET !== DEV_PROVIDER_LINK_SECRET,
    {
      message: 'PROVIDER_LINK_SECRET is required in production',
      path: ['PROVIDER_LINK_SECRET'],
    },
  );

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
