import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().default('postgres://fetivi:fetivi@127.0.0.1:5433/fetivi'),
  /** Without it, translations fail visibly as not-configured. */
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((s) => s || undefined),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
