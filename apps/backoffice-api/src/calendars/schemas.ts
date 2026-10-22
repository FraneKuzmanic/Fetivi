import { CALENDAR_LIMITS } from '@fetivi/domain';
import { z } from 'zod';
import { StayCreate } from '../stays/schemas';

export const FeedCreate = z.strictObject({ url: z.string().max(CALENDAR_LIMITS.urlLength) });

/** The dates come from the calendar; the host adds the party and the hand-over language. */
export const ProposalConfirm = StayCreate.omit({ checkIn: true, checkout: true });

export const ProposalsQuery = z.object({ unitId: z.uuid().optional() });
