import { checkoutFor, type Db, loadSituation } from '@fetivi/domain';
import { orderSummary } from '@fetivi/ui/payloads';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import type { ToolBinding, TurnTools } from '../tools/registry';

export interface OrderRouteDeps {
  db: Db;
  now: () => Date;
  tools: ToolBinding;
}

const listed = z.object({ orders: z.array(orderSummary) });
const OrderParams = z.object({ id: z.uuid() });

export const orderRoutes: FastifyPluginAsync<OrderRouteDeps> = async (app, deps) => {
  /**
   * My trip → Reservations & orders: every Order of the space, also after checkout. My trip calls
   * the permitted tool directly, without a model (architecture §4.3), so the authorization matrix
   * stays the one rule.
   */
  app.get('/api/orders', { config: { access: 'space' } }, async (request) => {
    const now = deps.now();
    const ctx = await loadSituation(deps.db, spaceOf(request).space.id, now);
    if (!ctx) throw new HttpError(401, 'no-space');
    let tools: TurnTools | null = null;
    try {
      tools = await deps.tools.open(ctx, now);
      const tool = (await tools.list()).find(
        (l) => l.server === 'services' && l.tool.name === 'list_my_orders',
      );
      if (!tool) throw new Error('list_my_orders not listed');
      return { orders: listed.parse(await tools.call(tool, {})).orders };
    } catch (error) {
      request.log.error({ err: error }, 'orders not listed');
      throw new HttpError(502, 'orders-unavailable');
    } finally {
      await tools?.close();
    }
  });

  /**
   * Pay now: the stored Stripe Checkout URL of a pay-online Order of the space, `preparing` while
   * the payment job is still opening it, or `closed` once the window has passed. The URL never
   * reaches the model; the stored chat receipt may be stale, so the server decides. POST, so the
   * space cookie's Origin rule applies.
   */
  app.post('/api/orders/:id/checkout', { config: { access: 'space' } }, async (request) => {
    const { id } = OrderParams.parse(request.params);
    const checkout = await checkoutFor(deps.db, spaceOf(request).space.id, id, deps.now());
    if (!checkout) throw new HttpError(404, 'not-found');
    return checkout;
  });
};
