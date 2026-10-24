import {
  backfillFieldTexts,
  createAnthropicDraftingModel,
  createAnthropicHandoffTranslator,
  createAnthropicTranslationModel,
  createDb,
  createJobQueue,
  createMailer,
  createStripeGateway,
  createWeatherSource,
  createWebPushSender,
} from '@fetivi/domain';
import { createEgress } from '@fetivi/egress';
import { loadConfig } from './config';
import { createJobsEgress } from './egress';
import { createJobs } from './jobs';
import { startJobRunner } from './runner';

const config = loadConfig();
const egress = createJobsEgress({ jadrolinija: config.JADROLINIJA_RSS_ENABLED });
const { db, pool } = createDb(config.DATABASE_URL);
const model = createAnthropicTranslationModel({
  apiKey: config.ANTHROPIC_API_KEY,
  fetch: egress.fetch,
});
const handoffTranslator = createAnthropicHandoffTranslator({
  apiKey: config.ANTHROPIC_API_KEY,
  fetch: egress.fetch,
});
const draftingModel = createAnthropicDraftingModel({
  apiKey: config.ANTHROPIC_API_KEY,
  fetch: egress.fetch,
});
if (!config.ANTHROPIC_API_KEY) {
  console.warn(
    'ANTHROPIC_API_KEY is not set: translations and catalog drafting will fail as not-configured',
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
