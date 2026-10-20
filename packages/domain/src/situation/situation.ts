import { type StayPhase, stayPhase } from '../stays/rules';
import type { CivilDate } from '../time';

/** Where a Space stands at one instant; decides the scopes its tokens carry. */
export interface Situation {
  /** Reuses stayPhase: 'upcoming' = before arrival, 'ended' = after checkout. */
  phase: StayPhase;
  insideDestination: boolean;
  hostHasOwnOffers: boolean;
}

export interface SituationInput {
  stay: { checkIn: CivilDate; activeUntil: Date };
  /** The property's IANA zone. */
  timezone: string;
  destinationId: string | null;
  hostHasOwnOffers: boolean;
}

/** After checkout starts at the end of checkout day (`activeUntil`), not at the checkout time. */
export function situationOf(input: SituationInput, now: Date): Situation {
  return {
    phase: stayPhase(input.stay, input.timezone, now),
    insideDestination: input.destinationId !== null,
    hostHasOwnOffers: input.hostHasOwnOffers,
  };
}
