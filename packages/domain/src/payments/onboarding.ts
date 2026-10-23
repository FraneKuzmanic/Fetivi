import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { providers } from '../db/schema/offers';
import { properties } from '../db/schema/properties';
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
      {
        owner: { kind: 'provider', id: provider.id },
        email: provider.email,
        displayName: provider.name,
      },
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

// A host's own connected account (38), for own services paid online: the same onboarding, with
// the host as merchant of record and the columns on `accounts`.

async function hostRow(db: Executor, hostId: string) {
  const [row] = await db
    .select({
      id: accounts.id,
      email: accounts.email,
      role: accounts.role,
      stripeAccountId: accounts.stripeAccountId,
    })
    .from(accounts)
    .where(eq(accounts.id, hostId));
  if (row?.role !== 'host') throw new OnboardingRuleError('not-found');
  return row;
}

/** The host's oldest property name, else the account email: what Stripe shows as the merchant. */
async function hostDisplayName(db: Executor, host: { id: string; email: string }) {
  const [property] = await db
    .select({ name: properties.name })
    .from(properties)
    .where(eq(properties.hostId, host.id))
    .orderBy(asc(properties.createdAt), asc(properties.id))
    .limit(1);
  return property?.name ?? host.email;
}

/** `providerOnboardingLink` for a host's own account (key `host:<id>:account`). */
export async function hostOnboardingLink(
  deps: OnboardingDeps,
  hostId: string,
  urls: { returnUrl: string; refreshUrl: string },
): Promise<{ url: string; expiresAt: Date }> {
  const host = await hostRow(deps.db, hostId);
  let accountId = host.stripeAccountId;
  if (!accountId) {
    const created = await deps.gateway.createConnectedAccount(
      {
        owner: { kind: 'host', id: host.id },
        email: host.email,
        displayName: await hostDisplayName(deps.db, host),
      },
      { idempotencyKey: `host:${host.id}:account` },
    );
    await deps.db
      .update(accounts)
      .set({ stripeAccountId: created.id, updatedAt: deps.now() })
      .where(and(eq(accounts.id, host.id), isNull(accounts.stripeAccountId)));
    accountId = (await hostRow(deps.db, hostId)).stripeAccountId ?? created.id;
  }
  return deps.gateway.createAccountLink({ accountId, ...urls });
}

/** Reads the host account's card capability from Stripe and stores it on the account. */
export async function refreshHostPayments(
  deps: OnboardingDeps,
  hostId: string,
): Promise<ProviderCardStatus> {
  const host = await hostRow(deps.db, hostId);
  if (!host.stripeAccountId) throw new OnboardingRuleError('no-account');
  const status = await deps.gateway.retrieveCardPaymentsStatus(host.stripeAccountId);
  await deps.db
    .update(accounts)
    .set({ stripeCardPayments: status, stripeCheckedAt: deps.now(), updatedAt: deps.now() })
    .where(eq(accounts.id, host.id));
  return status;
}
