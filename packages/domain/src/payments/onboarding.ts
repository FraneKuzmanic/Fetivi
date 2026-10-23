import { and, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { offers, providers } from '../db/schema/offers';
import type { PaymentGateway } from './gateway';
import type { ProviderCardStatus } from './vocabulary';

// Provider payment onboarding (Stripe Connect, Accounts v2, direct charges: the Provider is the
// merchant of record). The admin creates the connected account once and sends the Provider a
// hosted onboarding link; the card capability status is read and stored on the admin's Refresh
// and on the return from onboarding.

export interface OnboardingDeps {
  db: Executor;
  gateway: PaymentGateway;
  now: () => Date;
}

export class OnboardingRuleError extends Error {
  override name = 'OnboardingRuleError';
  constructor(readonly code: 'not-found' | 'no-account') {
    super(code);
  }
}

async function providerRow(db: Executor, providerId: string) {
  const [row] = await db
    .select({
      id: providers.id,
      name: providers.name,
      email: providers.email,
      stripeAccountId: providers.stripeAccountId,
    })
    .from(providers)
    .where(eq(providers.id, providerId));
  if (!row) throw new OnboardingRuleError('not-found');
  return row;
}

/**
 * A fresh onboarding link for the Provider's connected account, creating the account first when
 * there is none (idempotency key `provider:<id>:account`, and stored only where still null, so a
 * concurrent click keeps one account). Links are single-use and short-lived: never stored.
 */
export async function providerOnboardingLink(
  deps: OnboardingDeps,
  providerId: string,
  urls: { returnUrl: string; refreshUrl: string },
): Promise<{ url: string; expiresAt: Date }> {
  const provider = await providerRow(deps.db, providerId);
  let accountId = provider.stripeAccountId;
  if (!accountId) {
    const created = await deps.gateway.createConnectedAccount(
      { providerId: provider.id, email: provider.email, displayName: provider.name },
      { idempotencyKey: `provider:${provider.id}:account` },
    );
    await deps.db
      .update(providers)
      .set({ stripeAccountId: created.id, updatedAt: deps.now() })
      .where(and(eq(providers.id, provider.id), isNull(providers.stripeAccountId)));
    accountId = (await providerRow(deps.db, providerId)).stripeAccountId ?? created.id;
  }
  return deps.gateway.createAccountLink({ accountId, ...urls });
}

/** Reads the account's card capability from Stripe and stores it on the Provider. */
export async function refreshProviderPayments(
  deps: OnboardingDeps,
  providerId: string,
): Promise<ProviderCardStatus> {
  const provider = await providerRow(deps.db, providerId);
  if (!provider.stripeAccountId) throw new OnboardingRuleError('no-account');
  const status = await deps.gateway.retrieveCardPaymentsStatus(provider.stripeAccountId);
  await deps.db
    .update(providers)
    .set({ stripeCardPayments: status, stripeCheckedAt: deps.now(), updatedAt: deps.now() })
    .where(eq(providers.id, provider.id));
  return status;
}

/**
 * Whether a pay-online Offer can be booked in chat now: an allotment or on-request Offer of a
 * Provider whose stored card status is `active`, with a price (a request-kind Offer gets its
 * price from the Provider). Live (37) and host Offers (38) cannot yet.
 */
export async function providerAcceptsCards(db: Executor, offerId: string): Promise<boolean> {
  const [row] = await db
    .select({
      availabilityMode: offers.availabilityMode,
      priceMinor: offers.priceMinor,
      orderKind: offers.orderKind,
      stripeAccountId: providers.stripeAccountId,
      cardStatus: providers.stripeCardPayments,
    })
    .from(offers)
    .innerJoin(providers, eq(providers.id, offers.providerId))
    .where(eq(offers.id, offerId));
  return (
    row !== undefined &&
    (row.availabilityMode === 'allotment' || row.availabilityMode === 'on_request') &&
    (!!row.priceMinor || row.orderKind === 'request') &&
    !!row.stripeAccountId &&
    row.cardStatus === 'active'
  );
}
