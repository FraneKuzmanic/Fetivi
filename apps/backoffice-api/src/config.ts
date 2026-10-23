import { z } from 'zod';

const DEV_MAIL_FROM = 'Fetivi <notifications@localhost>';

const optionalString = z
  .string()
  .optional()
  .transform((s) => s || undefined);

const schema = z
  .object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.string().default('postgres://fetivi:fetivi@127.0.0.1:5433/fetivi'),
    /** The origin the back-office SPA is served from; write requests must carry it. */
    WEB_ORIGIN: z.url().default('http://localhost:5174'),
    /** The guest app's origin; units' QR codes link to it. */
    GUEST_ORIGIN: z.url().default('http://localhost:5173'),
    /** console logs mail (development); resend sends it (required in production). */
    MAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: optionalString,
    MAIL_FROM: z.string().default(DEV_MAIL_FROM),
    /** Resend's webhook signing secret (whsec_...); without it the bounce webhook is off. */
    RESEND_WEBHOOK_SECRET: optionalString,
    /** Stripe (sk_test_... in development), for Provider onboarding; without it onboarding is off. */
    STRIPE_SECRET_KEY: optionalString,
    /** The Stripe webhook signing secret (whsec_...); without it /webhooks/stripe is off. */
    STRIPE_WEBHOOK_SECRET: optionalString,
    NODE_ENV: z.string().optional(),
    /** Set behind Caddy (e.g. 'loopback') so login throttling sees the real client address. */
    TRUST_PROXY: z.string().optional(),
    /** Block media files. Both processes must point at the same directory (a shared volume in production). */
    MEDIA_DIR: z.string().default('../../.data/media'),
    /** The VAPID public key (same pair as jobs); without it the host's phone alerts are off. */
    VAPID_PUBLIC_KEY: optionalString,
    /** For the house manual import; without it, imports fail as not configured. */
    ANTHROPIC_API_KEY: z
      .string()
      .optional()
      .transform((s) => s || undefined),
  })
  .refine((c) => c.MAIL_TRANSPORT !== 'resend' || c.RESEND_API_KEY, {
    message: 'MAIL_TRANSPORT=resend needs RESEND_API_KEY',
    path: ['RESEND_API_KEY'],
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.MAIL_TRANSPORT === 'resend', {
    message: 'MAIL_TRANSPORT=resend is required in production',
    path: ['MAIL_TRANSPORT'],
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.MAIL_FROM !== DEV_MAIL_FROM, {
    message: 'MAIL_FROM is required in production',
    path: ['MAIL_FROM'],
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
