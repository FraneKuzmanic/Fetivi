import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { accounts } from '../db/schema/accounts';
import { offers, providers } from '../db/schema/offers';
import type { ProviderCardStatus } from './vocabulary';

// The merchant of record of an Offer (direct charges): its Provider, or for an own service the
// host's own connected account (38).

export interface Merchant {
  kind: 'provider' | 'host';
  stripeAccountId: string | null;
  cardStatus: ProviderCardStatus | null;
  /** Fetivi's commission; always 0 for a host's own Offer (AC 2, 38). */
  commissionBp: number;
}

async function merchantRow(db: Executor, offerId: string) {
  const [row] = await db
    .select({
      availabilityMode: offers.availabilityMode,
      priceMinor: offers.priceMinor,
      orderKind: offers.orderKind,
      providerId: offers.providerId,
      providerAccountId: providers.stripeAccountId,
      providerCardStatus: providers.stripeCardPayments,
      providerCommissionBp: providers.commissionBp,
      hostAccountId: accounts.stripeAccountId,
      hostCardStatus: accounts.stripeCardPayments,
    })
    .from(offers)
    .leftJoin(providers, eq(providers.id, offers.providerId))
    .leftJoin(accounts, eq(accounts.id, offers.hostId))
    .where(eq(offers.id, offerId));
  if (!row) return undefined;
  const merchant: Merchant = row.providerId
    ? {
        kind: 'provider',
        stripeAccountId: row.providerAccountId,
        cardStatus: row.providerCardStatus,
        commissionBp: row.providerCommissionBp ?? 0,
      }
    : {
        kind: 'host',
        stripeAccountId: row.hostAccountId,
        cardStatus: row.hostCardStatus,
        commissionBp: 0,
      };
  return { ...row, merchant };
}

/** The Offer's merchant, or null when the Offer is gone. */
export async function merchantOf(db: Executor, offerId: string): Promise<Merchant | null> {
  return (await merchantRow(db, offerId))?.merchant ?? null;
}

/**
 * Whether a pay-online Offer can be booked in chat now: an allotment or on-request Offer whose
 * merchant (Provider or host, 38) has a stored card status of `active`, with a price (a
 * request-kind Offer gets its price from the answer). Live (37) cannot yet.
 */
export async function merchantAcceptsCards(db: Executor, offerId: string): Promise<boolean> {
  const row = await merchantRow(db, offerId);
  return (
    row !== undefined &&
    (row.availabilityMode === 'allotment' || row.availabilityMode === 'on_request') &&
    (!!row.priceMinor || row.orderKind === 'request') &&
    !!row.merchant.stripeAccountId &&
    row.merchant.cardStatus === 'active'
  );
}
