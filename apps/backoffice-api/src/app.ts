import type {
  Db,
  JobQueue,
  Mailer,
  ManualImportModel,
  MediaStore,
  PaymentGateway,
} from '@fetivi/domain';
import Fastify from 'fastify';
import { curationRoutes } from './admin/curation';
import { draftingRoutes } from './admin/drafting';
import { feedbackStatsRoutes } from './admin/feedback';
import { adminOrderRoutes } from './admin/orders';
import { reconciliationRoutes } from './admin/reconciliation';
import { adminRoutes } from './admin/routes';
import { seedingRoutes } from './admin/seeding';
import { registerAuth } from './auth/plugin';
import { authRoutes } from './auth/routes';
import { calendarRoutes } from './calendars/routes';
import { catalogRoutes } from './catalog/routes';
import { hostNotificationRoutes } from './host/notifications';
import { hostRoutes } from './host/routes';
import { hostStatsRoutes } from './host/stats';
import { hostSuggestionRoutes } from './host/suggestions';
import { hostOfferRoutes } from './host-offers/routes';
import { hostOrderRoutes } from './host-orders/routes';
import { hostPaymentRoutes } from './host-payments/routes';
import { hostPickRoutes } from './host-picks/routes';
import { hostProviderRoutes } from './host-providers/routes';
import { registerErrorHandler } from './http-error';
import { inboxRoutes } from './inbox/routes';
import { manualImportRoutes } from './manual-import/routes';
import { mediaRoutes } from './media/routes';
import { propertyRoutes } from './properties/routes';
import { providerLinkRoutes } from './provider-link/routes';
import { onboardingRoutes } from './providers/onboarding';
import { providerRoutes } from './providers/routes';
import { stayRoutes } from './stays/routes';
import { resendWebhookRoutes } from './webhooks/resend';
import { stripeWebhookRoutes } from './webhooks/stripe';

export interface AppDeps {
  db: Db;
  mailer: Mailer;
  /** Sends jobs and events inside the caller's transaction. */
  queue: JobQueue;
  webOrigin: string;
  /** Where unit QR codes point. */
  guestOrigin: string;
  now?: () => Date;
  logger?: boolean;
  /** Proxy addresses whose X-Forwarded-For is believed (e.g. 'loopback'); unset trusts none. */
  trustProxy?: string | undefined;
  /** Block media files. */
  media: MediaStore;
  /** Reads house manuals for the import; tests pass a scripted stub. */
  manualImportModel: ManualImportModel;
  /** Resend's webhook signing secret; without it `/webhooks/resend` is not registered. */
  resendWebhookSecret?: string | undefined;
  /** The VAPID public key for the host's phone alerts; unset turns them off. */
  vapidPublicKey?: string | undefined;
  /**
   * Stripe, for Provider onboarding and the payment webhook. Without a gateway onboarding answers
   * 503; without the webhook secret `/webhooks/stripe` is not registered.
   */
  stripe?: { gateway: PaymentGateway; webhookSecret?: string | undefined } | undefined;
}

export function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? true, trustProxy: deps.trustProxy ?? false });
  const now = deps.now ?? (() => new Date());
  const { db, mailer, queue, webOrigin, guestOrigin } = deps;

  registerErrorHandler(app);
  registerAuth(app, { db, webOrigin, now });

  app.get('/health', async () => ({ status: 'ok', service: 'backoffice-api' }));
  app.register(authRoutes, { db, mailer, webOrigin, now });
  app.register(hostRoutes, { db });
  app.register(hostStatsRoutes, { db, now });
  app.register(hostSuggestionRoutes, { db, now });
  app.register(propertyRoutes, { db, queue, now, guestOrigin, media: deps.media });
  app.register(mediaRoutes, { db, queue, now, media: deps.media });
  app.register(manualImportRoutes, { db, queue, now, model: deps.manualImportModel });
  app.register(adminRoutes, { db, now });
  app.register(reconciliationRoutes, { db, queue, now });
  app.register(curationRoutes, { db, queue, now });
  app.register(feedbackStatsRoutes, { db });
  app.register(seedingRoutes, { db, queue, now });
  app.register(draftingRoutes, { db, queue, now });
  app.register(adminOrderRoutes, { db, queue, now });
  app.register(catalogRoutes, { db, queue, now });
  app.register(providerRoutes, { db, queue, now });
  app.register(onboardingRoutes, { db, now, webOrigin, gateway: deps.stripe?.gateway ?? null });
  app.register(providerLinkRoutes, { db, queue, now });
  app.register(stayRoutes, { db, now, guestOrigin });
  app.register(calendarRoutes, { db, queue, now, guestOrigin });
  app.register(inboxRoutes, { db, queue, now });
  app.register(hostOfferRoutes, { db, queue, now });
  app.register(hostOrderRoutes, { db, queue, now });
  app.register(hostProviderRoutes, { db, now });
  app.register(hostPickRoutes, { db, queue, now });
  app.register(hostPaymentRoutes, { db, now, webOrigin, gateway: deps.stripe?.gateway ?? null });
  app.register(hostNotificationRoutes, { db, now, vapidPublicKey: deps.vapidPublicKey ?? null });
  if (deps.resendWebhookSecret) {
    app.register(resendWebhookRoutes, { db, now, secret: deps.resendWebhookSecret });
  }
  if (deps.stripe?.webhookSecret) {
    app.register(stripeWebhookRoutes, {
      db,
      queue,
      now,
      secret: deps.stripe.webhookSecret,
      gateway: deps.stripe.gateway,
    });
  }
  return app;
}
