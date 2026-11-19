import {
  checkAnthropicKey,
  createAnthropicManualImportModel,
  createDb,
  createJobQueue,
  createLlmKeySource,
  createLocalMediaStore,
  createMailer,
  createPhotonGeocoder,
  createStripeGateway,
  ensureQueues,
  usageRecorder,
} from '@fetivi/domain';
import { W3CTraceContextPropagator } from '@fetivi/telemetry';
import { PgBoss } from 'pg-boss';
import { buildApp } from './app';
import { loadConfig } from './config';
import { egress } from './egress';

const config = loadConfig();
if (!config.ANTHROPIC_API_KEY) {
  console.info(
    'ANTHROPIC_API_KEY is not set: house manual imports need a key in the admin settings',
  );
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
// The admin's key from Settings, else ANTHROPIC_API_KEY (68); the settings routes invalidate it.
const llmKeys = createLlmKeySource({
  db,
  envKey: config.ANTHROPIC_API_KEY,
  secret: config.LLM_KEY_SECRET,
  warn: console.warn,
});
const app = buildApp({
  db,
  mailer: createMailer({
    transport: config.MAIL_TRANSPORT,
    resendApiKey: config.RESEND_API_KEY,
    mailpitUrl: config.MAILPIT_URL,
    from: config.MAIL_FROM,
    fetch: egress.fetch,
  }),
  queue: createJobQueue(boss),
  webOrigin: config.WEB_ORIGIN,
  guestOrigin: config.GUEST_ORIGIN,
  trustProxy: config.TRUST_PROXY,
  media: createLocalMediaStore(config.MEDIA_DIR),
  manualImportModel: createAnthropicManualImportModel({
    apiKey: llmKeys.get,
    fetch: egress.fetch,
    onUsage: usageRecorder(db, 'manual_import'),
  }),
  llmKeys,
  llmEnvKey: config.ANTHROPIC_API_KEY,
  llmKeySecret: config.LLM_KEY_SECRET,
  checkLlmKey: (key) => checkAnthropicKey(key, egress.fetch),
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
