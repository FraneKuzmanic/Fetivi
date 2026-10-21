import type { Executor } from '../../db/client';
import type { AvailabilityMode } from '../../offers/vocabulary';
import type { CivilDate } from '../../time';

// The Provider adapter seam (architecture §4.3): one implementation per availability mode, hidden
// behind the services tools. The model never sees an adapter.

/** The adapter's view of the database: a transaction when called by the machine. */
export interface AdapterContext {
  db: Executor;
  now: () => Date;
}

export interface AvailabilityQuery {
  offerId: string;
  date: CivilDate;
  quantity: number;
  /** The zone `date` is read in. */
  zone: string;
}

/** One bookable start; `remaining` is null when the system does not say. */
export interface AvailableStart {
  slotId: string | null;
  startsAt: Date | null;
  remaining: number | null;
}

export interface HoldRequest {
  orderId: string;
  proposalId: string;
  slotId: string | null;
  quantity: number;
  expiresAt: Date;
}

export interface HoldResult {
  ref: string;
  expiresAt: Date;
}

export interface ProposalRef {
  orderId: string;
  proposalId: string;
}

/** What the Provider's system knows under a reference (the Order id). */
export interface LookupResult {
  state: 'held' | 'committed' | 'released' | 'not_found';
  proposalId: string | null;
  externalRef: string | null;
}

/** A cancellation from the Provider's side. `proposalId` binds it to the terms the Provider saw. */
export interface InboundCancellation {
  reference: string;
  proposalId?: string;
}

export interface ProviderAdapter {
  readonly mode: AvailabilityMode;
  checkAvailability(ctx: AdapterContext, query: AvailabilityQuery): Promise<AvailableStart[]>;
  /** Takes capacity for one proposal until `expiresAt`. Idempotent per proposal. Throws AdapterError('sold-out'), or 'hold-gone' once the proposal's hold was released. */
  hold(ctx: AdapterContext, request: HoldRequest): Promise<HoldResult>;
  /** Turns the proposal's hold into a reservation under the Order id. Idempotent. Throws AdapterError('hold-gone') after release. */
  commit(ctx: AdapterContext, ref: ProposalRef): Promise<{ externalRef: string }>;
  /** Frees a hold that was not committed. Idempotent. */
  release(ctx: AdapterContext, ref: ProposalRef): Promise<void>;
  /** Cancels a committed reservation and returns its capacity. Idempotent. */
  cancel(ctx: AdapterContext, ref: ProposalRef): Promise<void>;
  lookup(ctx: AdapterContext, reference: string): Promise<LookupResult>;
  /** Maps a cancellation from the Provider's side to the Order it concerns, or null when unknown. */
  resolveInboundCancellation(
    ctx: AdapterContext,
    event: InboundCancellation,
  ): Promise<ProposalRef | null>;
}

export class AdapterError extends Error {
  override name = 'AdapterError';
  constructor(readonly code: 'sold-out' | 'hold-gone' | 'invalid-input' | 'not-supported') {
    super(code);
  }
}
