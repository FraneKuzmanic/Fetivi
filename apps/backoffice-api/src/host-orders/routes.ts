import {
  acceptOrder,
  acknowledgeOrder,
  cannotFulfil,
  type Db,
  declineOrder,
  findHostOrder,
  type JobQueue,
  OrderRuleError,
  proposeOrder,
  providerLinkView,
  type TransitionOutcome,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../auth/plugin';
import { HttpError } from '../http-error';
import { checkNewTerms } from '../provider-link/terms';
import { hostIdOf } from '../stays/routes';
import { HostOrderAction, HostOrderParams } from './schemas';

export interface HostOrderDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

/**
 * The host answers the Orders on their own Offers (38, ADR 0016): the Provider link's view and
 * actions, reached through the session. Each action records trigger `provider_link` with the
 * signed-in account (the host, or an admin acting as them) as the actor.
 */
export async function hostOrderRoutes(app: FastifyInstance, deps: HostOrderDeps): Promise<void> {
  const { db } = deps;
  const host = { config: { access: 'host' as const } };

  async function viewOf(request: FastifyRequest) {
    const { id } = HostOrderParams.parse(request.params);
    const found = await findHostOrder(db, hostIdOf(request), id);
    if (!found) throw new HttpError(404, 'not-found');
    return providerLinkView(found);
  }

  app.get('/api/host/orders/:id', host, async (request) => ({ order: await viewOf(request) }));

  app.post('/api/host/orders/:id/actions', host, async (request) => {
    const view = await viewOf(request);
    const body = HostOrderAction.parse(request.body);
    const { action, proposalId } = body;
    if (proposalId !== view.proposalId) return { outcome: 'stale', order: view };
    if (!view.actions.includes(action)) return { outcome: 'rejected', order: view };

    const ref = { orderId: view.orderId, proposalId };
    const actorId = principalOf(request).account.id;
    let result: TransitionOutcome;
    try {
      if (action === 'suggest_time' || action === 'accept_with_price') {
        const terms = checkNewTerms(view, body, action === 'accept_with_price');
        if (typeof terms === 'string') throw new HttpError(400, 'invalid-input');
        result = await proposeOrder(deps, ref, terms, actorId);
      } else if (action === 'acknowledge') {
        result = await acknowledgeOrder(deps, ref);
      } else if (action === 'accept') {
        result = await acceptOrder(deps, ref, actorId);
      } else if (action === 'decline') {
        result = await declineOrder(deps, ref, actorId);
      } else {
        // The confirmation lives in the inbox's dialog, so this is the confirmed tap.
        result = await cannotFulfil(deps, ref, actorId);
      }
    } catch (error) {
      // The machine refuses terms the form can't see, such as a start that has passed.
      if (
        error instanceof OrderRuleError &&
        (error.code === 'invalid-input' || error.code === 'date-outside-stay')
      ) {
        throw new HttpError(400, 'invalid-input');
      }
      throw error;
    }
    return { outcome: result.outcome, order: await viewOf(request) };
  });
}
