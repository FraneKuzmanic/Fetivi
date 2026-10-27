import {
  accounts,
  type Db,
  disconnectHostPayments,
  hostOnboardingLink,
  type PaymentGateway,
  refreshHostPayments,
} from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../http-error';
import { withPaymentErrors } from '../providers/onboarding';
import { hostIdOf } from '../stays/routes';

export interface HostPaymentDeps {
  db: Db;
  now: () => Date;
  webOrigin: string;
  /** Null when STRIPE_SECRET_KEY is not set: the Stripe routes answer 503. */
  gateway: PaymentGateway | null;
}

/**
 * A host's own Stripe account (38) for own services paid online: 33's Accounts v2 onboarding,
 * with the host as merchant of record.
 */
export async function hostPaymentRoutes(app: FastifyInstance, deps: HostPaymentDeps) {
  const { db, now, webOrigin } = deps;
  const host = { config: { access: 'host' as const } };
  const gatewayOf = () => {
    if (!deps.gateway) throw new HttpError(503, 'payments-not-configured');
    return deps.gateway;
  };

  async function statusOf(hostId: string) {
    const [row] = await db
      .select({
        stripeAccountId: accounts.stripeAccountId,
        stripeCardPayments: accounts.stripeCardPayments,
        stripeCheckedAt: accounts.stripeCheckedAt,
      })
      .from(accounts)
      .where(eq(accounts.id, hostId));
    if (!row) throw new HttpError(404, 'not-found');
    return {
      /** The raw Stripe id is not exposed. */
      stripeConnected: row.stripeAccountId !== null,
      stripeCardPayments: row.stripeCardPayments,
      stripeCheckedAt: row.stripeCheckedAt?.toISOString() ?? null,
    };
  }

  app.get('/api/host/payments', host, async (request) => statusOf(hostIdOf(request)));

  app.post('/api/host/payments/stripe/onboarding-link', host, async (request) => {
    const hostId = hostIdOf(request);
    const gateway = gatewayOf();
    const page = `${webOrigin}/settings/payments`;
    const link = await withPaymentErrors(() =>
      hostOnboardingLink({ db, gateway, now }, hostId, {
        returnUrl: `${page}?stripe=return`,
        refreshUrl: `${page}?stripe=refresh`,
      }),
    );
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  });

  app.post('/api/host/payments/stripe/refresh', host, async (request) => {
    const hostId = hostIdOf(request);
    const gateway = gatewayOf();
    await withPaymentErrors(() => refreshHostPayments({ db, gateway, now }, hostId));
    return statusOf(hostId);
  });

  /** Unlinks the account (Stripe keeps it); 409 open-card-orders while a card Order is open. */
  app.post('/api/host/payments/stripe/disconnect', host, async (request) => {
    const hostId = hostIdOf(request);
    await withPaymentErrors(() => disconnectHostPayments({ db, now }, hostId));
    return statusOf(hostId);
  });
}
