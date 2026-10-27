import {
  createAnthropicManualImportModel,
  createDb,
  createJobQueue,
  createLocalMediaStore,
  createMailer,
  createPhotonGeocoder,
  createStripeGateway,
  ensureQueues,
} from '@fetivi/domain';
import { W3CTraceContextPropagator } from '@fetivi/telemetry';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { loadConfig } from './config';
import { egress } from './egress';

const config = loadConfig();
if (!config.ANTHROPIC_API_KEY) {
  console.warn('ANTHROPIC_API_KEY is not set: house manual imports will fail as not configured');
}
const gateway = config.STRIPE_SECRET_KEY
  ? createStripeGateway({ apiKey: config.STRIPE_SECRET_KEY, fetch: egress.fetch })
  : null;
if (!gateway) console.warn('STRIPE_SECRET_KEY is not set: Provider payment onboarding is off');
const { db, pool } = createDb(config.DATABASE_URL);
// Only sends jobs; the jobs process works them.
const boss = new PgBoss({
  connectionString: config.DATABASE_URL,
  supervise: false,
  schedule: false,
  openTelemetry: { propagateContext: true, propagator: new W3CTraceContextPropagator() },
});
boss.on('error', (error) => console.error('pg-boss error', error));
await boss.start();
await ensureQueues(boss);
const app = buildApp({
  db,
  mailer: createMailer({
    transport: config.MAIL_TRANSPORT,
    resendApiKey: config.RESEND_API_KEY,
    from: config.MAIL_FROM,
    fetch: egress.fetch,
  }),
  queue: createJobQueue(boss),
  webOrigin: config.WEB_ORIGIN,
  guestOrigin: config.GUEST_ORIGIN,
  trustProxy: config.TRUST_PROXY,
  media: createLocalMediaStore(config.MEDIA_DIR),
  manualImportModel: createAnthropicManualImportModel({
    apiKey: config.ANTHROPIC_API_KEY,
    fetch: egress.fetch,
  }),
  resendWebhookSecret: config.RESEND_WEBHOOK_SECRET,
  vapidPublicKey: config.VAPID_PUBLIC_KEY,
  stripe: gateway ? { gateway, webhookSecret: config.STRIPE_WEBHOOK_SECRET } : undefined,
  geocoder: config.GEOCODER_ENABLED
    ? createPhotonGeocoder({ fetch: egress.fetch, userAgent: config.GEOCODER_USER_AGENT })
    : null,
});

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => boss.stop({ graceful: true }))
      .then(() => pool.end());
  });
}
