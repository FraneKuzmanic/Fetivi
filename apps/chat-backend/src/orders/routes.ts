import { type Db, loadSituation } from '@fetivi/domain';
import type { Egress } from '@fetivi/egress';
import { orderSummary } from '@fetivi/ui/payloads';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import { openTurnClients, type TurnClients } from '../mcp/clients';
import { mintServerTokens, type TokenConfig } from '../tokens/mint';

export interface OrderRouteDeps {
  db: Db;
  now: () => Date;
  tokens: TokenConfig;
  mcpFetch: Egress['fetch'];
}

const listed = z.object({ orders: z.array(orderSummary) });

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
    let clients: TurnClients | null = null;
    try {
      clients = openTurnClients({
        tokens: await mintServerTokens(deps.tokens, ctx, now),
        baseUrl: deps.tokens.mcpBaseUrl,
        fetch: deps.mcpFetch,
      });
      const result = await (await clients.get('services')).callTool({
        name: 'list_my_orders',
        arguments: {},
      });
      if (result.isError) throw new Error('list_my_orders refused');
      return { orders: listed.parse(result.structuredContent).orders };
    } catch (error) {
      request.log.error({ err: error }, 'orders not listed');
      throw new HttpError(502, 'orders-unavailable');
    } finally {
      await clients?.close();
    }
  });
};
