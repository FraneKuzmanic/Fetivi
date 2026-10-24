import { type Db, unitAnswerStats } from '@fetivi/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findOwnedUnit } from '../properties/store';
import { hostIdOf } from '../stays/routes';

export interface HostStatsDeps {
  db: Db;
  now: () => Date;
}

const IdParams = z.object({ id: z.uuid() });

/**
 * A unit's guest stats (43 AC 3): counts and topics only, never transcripts (PRD §6.5). Another
 * host's unit is 404, like a missing one.
 */
export async function hostStatsRoutes(app: FastifyInstance, deps: HostStatsDeps): Promise<void> {
  const { db, now } = deps;
  app.get('/api/host/units/:id/stats', { config: { access: 'host' } }, async (request) => {
    const { id } = IdParams.parse(request.params);
    const { unit } = await findOwnedUnit(db, hostIdOf(request), id);
    return { unit: { id: unit.id, name: unit.name }, ...(await unitAnswerStats(db, id, now())) };
  });
}
