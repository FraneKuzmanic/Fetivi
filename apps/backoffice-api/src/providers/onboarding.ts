import {
  type Db,
  OnboardingRuleError,
  type PaymentGateway,
  PaymentGatewayError,
  providerOnboardingLink,
  refreshProviderPayments,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../http-error';
import { findProvider, providerOut } from './out';

export interface OnboardingRouteDeps {
  db: Db;
  now: () => Date;
  webOrigin: string;
  /** Null when STRIPE_SECRET_KEY is not set: both routes answer 503. */
  gateway: PaymentGateway | null;
}

const IdParams = z.object({ id: z.uuid() });

/** Turns onboarding and Stripe errors into HTTP errors. */
export async function withPaymentErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OnboardingRuleError) {
      throw new HttpError(error.code === 'not-found' ? 404 : 409, error.code);
    }
    if (error instanceof PaymentGatewayError) {
      if (error.code === 'unavailable') throw new HttpError(502, 'stripe-unavailable');
      throw new HttpError(400, 'stripe-rejected');
    }
    throw error;
  }
}

/** Provider payment onboarding (Stripe Connect, Accounts v2; the Provider is merchant of record). */
export async function onboardingRoutes(app: FastifyInstance, deps: OnboardingRouteDeps) {
  const { db, now, webOrigin } = deps;
  const admin = { config: { access: 'admin' as const } };
  const idOf = (request: FastifyRequest) => IdParams.parse(request.params).id;
  const gatewayOf = () => {
    if (!deps.gateway) throw new HttpError(503, 'payments-not-configured');
    return deps.gateway;
  };

  app.post('/api/admin/providers/:id/stripe/onboarding-link', admin, async (request) => {
    const id = idOf(request);
    const gateway = gatewayOf();
    const page = `${webOrigin}/admin/providers/${id}`;
    const link = await withPaymentErrors(() =>
      providerOnboardingLink({ db, gateway, now }, id, {
        returnUrl: `${page}?stripe=return`,
        refreshUrl: `${page}?stripe=refresh`,
      }),
    );
    return { url: link.url, expiresAt: link.expiresAt.toISOString() };
  });

  app.post('/api/admin/providers/:id/stripe/refresh', admin, async (request) => {
    const id = idOf(request);
    const gateway = gatewayOf();
    await withPaymentErrors(() => refreshProviderPayments({ db, gateway, now }, id));
    const { provider, offerCount } = await findProvider(db, id);
    return providerOut(provider, offerCount);
  });
}
