import {
  backfillFieldTexts,
  createDb,
  createDraftingModel,
  createHandoffTranslator,
  createJobQueue,
  createLlmKeySource,
  createMailer,
  createStripeGateway,
  createTranslationModel,
  createVoyageEmbedder,
  createWeatherSource,
  createWebPushSender,
  usageRecorder,
} from '@fetivi/domain';
import { createEgress } from '@fetivi/egress';
import { loadConfig } from './config';
import { createJobsEgress } from './egress';
import { createJobs } from './jobs';
import { startJobRunner } from './runner';

const config = loadConfig();
const egress = createJobsEgress({ jadrolinija: config.JADROLINIJA_RSS_ENABLED });
const { db, pool } = createDb(config.DATABASE_URL);
// The admin's key from Settings, else ANTHROPIC_API_KEY, resolved per call (68).
const llmKeys = createLlmKeySource({
  db,
  envKey: config.ANTHROPIC_API_KEY,
  secret: config.LLM_KEY_SECRET,
  warn: console.warn,
});
const model = createTranslationModel({
  llm: llmKeys.get,
  fetch: egress.fetch,
  onUsage: usageRecorder(db, 'translation'),
});
const handoffTranslator = createHandoffTranslator({
  llm: llmKeys.get,
  fetch: egress.fetch,
  onUsage: usageRecorder(db, 'handoff_translation'),
});
const draftingModel = createDraftingModel({
  llm: llmKeys.get,
  fetch: egress.fetch,
  onUsage: usageRecorder(db, 'drafting'),
});
if (!config.ANTHROPIC_API_KEY) {
  console.info(
    'ANTHROPIC_API_KEY is not set: translations and catalog drafting need a key in the admin settings',
  );
}
const push =
  config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
    ? createWebPushSender({
        publicKey: config.VAPID_PUBLIC_KEY,
        privateKey: config.VAPID_PRIVATE_KEY,
        subject: config.VAPID_SUBJECT,
        fetch: egress.fetch,
      })
    : null;
if (!push) console.warn('VAPID keys are not set: push notifications are skipped');
const gateway = config.STRIPE_SECRET_KEY
  ? createStripeGateway({ apiKey: config.STRIPE_SECRET_KEY, fetch: egress.fetch })
  : null;
if (!gateway) console.warn('STRIPE_SECRET_KEY is not set: online payments are off');
const embedder = createVoyageEmbedder({ fetch: egress.fetch, apiKey: config.VOYAGE_API_KEY });
if (!config.VOYAGE_API_KEY) {
  console.warn(
    'VOYAGE_API_KEY is not set: search falls back to word matching and nothing is embedded',
  );
}
const weather = createWeatherSource({ fetch: egress.fetch, userAgent: config.WEATHER_USER_AGENT });
const boss = await startJobRunner({
  connectionString: config.DATABASE_URL,
  jobs: (boss) =>
    createJobs({
      db,
      queue: createJobQueue(boss),
      model,
      handoffTranslator,
      now: () => new Date(),
      mailer: createMailer({
        transport: config.MAIL_TRANSPORT,
        resendApiKey: config.RESEND_API_KEY,
        mailpitUrl: config.MAILPIT_URL,
        from: config.MAIL_FROM,
        fetch: egress.fetch,
      }),
      push,
      guestOrigin: config.GUEST_ORIGIN,
      guestLinkSecret: config.GUEST_LINK_SECRET,
      providerLink: {
        secret: config.PROVIDER_LINK_SECRET,
        baseUrl: config.PROVIDER_LINK_BASE_URL,
      },
      fetch: egress.fetch,
      webOrigin: config.WEB_ORIGIN,
      weather,
      gateway,
      jadrolinija: config.JADROLINIJA_RSS_ENABLED,
      userAgent: config.WEATHER_USER_AGENT,
      draftingModel,
      embedder,
      // Each drafting task reads only its own venue, social and tourist-board hosts.
      fetchFor: (allowlist) => createEgress({ allowlist }).fetch,
    }),
});
console.log('job runner started');
// Ticket 50: field text saved before translation existed gets its first job; idempotent.
const queued = await backfillFieldTexts(db, createJobQueue(boss), new Date());
console.log(JSON.stringify({ backfill: 'field-texts', queued }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void boss.stop({ graceful: true }).then(() => pool.end());
  });
}
