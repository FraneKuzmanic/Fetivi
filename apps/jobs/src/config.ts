import { z } from 'zod';

const DEV_PROVIDER_LINK_SECRET = 'dev-only-provider-link-secret-change-me-in-production';
const DEV_GUEST_LINK_SECRET = 'dev-only-guest-link-secret-change-me-in-production';

const DEV_MAIL_FROM = 'Fetivi <notifications@localhost>';
const DEV_GUEST_ORIGIN = 'http://localhost:5173';

const optionalString = z
  .string()
  .optional()
  .transform((s) => s || undefined);

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
    /** Signs the daily-tip unsubscribe links; chat-backend must have the same value. */
    GUEST_LINK_SECRET: z.string().min(32).default(DEV_GUEST_LINK_SECRET),
    /** The back-office origin the Provider page is served from (production https://host.<domain>). */
    PROVIDER_LINK_BASE_URL: z.url().default('http://localhost:5174'),
    /** The back-office origin, for links in host emails (production https://host.<domain>). */
    WEB_ORIGIN: z.url().default('http://localhost:5174'),
    /** console logs mail (development); resend sends it (required in production). */
    MAIL_TRANSPORT: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: optionalString,
    MAIL_FROM: z.string().default(DEV_MAIL_FROM),
    /** The guest-app origin, for links in guest emails (production https://<domain>). */
    GUEST_ORIGIN: z.url().default(DEV_GUEST_ORIGIN),
    /** Web push (VAPID). Without the keys the push channel is skipped. */
    VAPID_PUBLIC_KEY: optionalString,
    VAPID_PRIVATE_KEY: optionalString,
    VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),
    /** Stripe, for pay-online checkout, capture, void and refund. Without it online payments are off. */
    STRIPE_SECRET_KEY: optionalString,
    /** Voyage AI embeddings of published catalog text for search; without it nothing is embedded. */
    VOYAGE_API_KEY: optionalString,
    /** DHMZ and Jadrolinija get an identifying agent; production sets a reachable one. */
    WEATHER_USER_AGENT: z
      .string()
      .min(10)
      .default('Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)'),
    /** Off until Jadrolinija gives written permission to poll its feed (PRD §9). */
    JADROLINIJA_RSS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .refine(
    (c) => c.NODE_ENV !== 'production' || c.PROVIDER_LINK_SECRET !== DEV_PROVIDER_LINK_SECRET,
    {
      message: 'PROVIDER_LINK_SECRET is required in production',
      path: ['PROVIDER_LINK_SECRET'],
    },
  )
  .refine((c) => c.NODE_ENV !== 'production' || c.GUEST_LINK_SECRET !== DEV_GUEST_LINK_SECRET, {
    message: 'GUEST_LINK_SECRET is required in production',
    path: ['GUEST_LINK_SECRET'],
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
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.GUEST_ORIGIN !== DEV_GUEST_ORIGIN, {
    message: 'GUEST_ORIGIN is required in production',
    path: ['GUEST_ORIGIN'],
  })
  .refine((c) => !c.VAPID_PUBLIC_KEY === !c.VAPID_PRIVATE_KEY, {
    message: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY go together',
    path: ['VAPID_PRIVATE_KEY'],
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return schema.parse(env);
}
