import { randomUUID } from 'node:crypto';
import { checkoutFor, type Db, loadSituation } from '@fetivi/domain';
import { orderSummary } from '@fetivi/ui/payloads';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import { guestAnswer, type Outcome } from '../loop/elicitation';
import type { FirstPartyListed } from '../mcp/tools';
import type { ToolBinding, TurnTools } from '../tools/registry';

export interface OrderRouteDeps {
  db: Db;
  now: () => Date;
  tools: ToolBinding;
}

const listed = z.object({ orders: z.array(orderSummary) });
const OrderParams = z.object({ id: z.uuid() });

/** The paused tools My trip may answer after checkout. */
const ACTION_TOOLS = ['cancel_order', 'respond_to_order_update'] as const;
type ActionTool = (typeof ACTION_TOOLS)[number];

const answerBody = z.strictObject({
  toolName: z.enum(ACTION_TOOLS),
  requestState: z.string().min(1).max(4096),
  action: guestAnswer.shape.action,
  content: guestAnswer.shape.content,
});

/** What both tools return once answered. */
const actionOutput = z.object({ outcome: z.string(), order: orderSummary.nullable() });

/**
 * A half's outcome as the browser gets it: the card, or the outcome with the Order. A refusal is
 * a 409; the tool's English text is for a model and never reaches the browser.
 */
function toResponse(outcome: Outcome) {
  if (outcome.kind === 'ask') return { card: outcome.payload };
  if (outcome.kind === 'error') throw new HttpError(409, 'action-refused');
  return actionOutput.parse(outcome.output);
}

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
   * Runs one listed `services` tool of the space's situation. A tool the token does not list is
   * a 403: the authorization matrix refused it.
   */
  async function withServicesTool<T>(
    request: FastifyRequest,
    name: ActionTool,
    run: (tools: TurnTools, listed: FirstPartyListed) => Promise<T>,
  ): Promise<T> {
    const now = deps.now();
    const ctx = await loadSituation(deps.db, spaceOf(request).space.id, now);
    if (!ctx) throw new HttpError(401, 'no-space');
    let tools: TurnTools | null = null;
    try {
      tools = await deps.tools.open(ctx, now);
      const found = (await tools.list()).find(
        (l): l is FirstPartyListed => l.server === 'services' && l.tool.name === name,
      );
      if (!found) throw new HttpError(403, 'not-permitted');
      return await run(tools, found);
    } finally {
      await tools?.close();
    }
  }

  // After checkout the chat is closed, so My trip answers unresolved Orders here, calling the
  // permitted tool directly without a model (architecture §4.3). The token's scopes stay the one
  // rule; `requestState` is the server's own HMAC-sealed state, and the pending record is bound to
  // the Space. Never log `requestState` or the answer. POSTs, so the space cookie's Origin rule
  // applies.
  const firstHalfRoute = (path: string, toolName: ActionTool) =>
    app.post(path, { config: { access: 'space' } }, async (request) => {
      const { id } = OrderParams.parse(request.params);
      return withServicesTool(request, toolName, async (tools, listed) =>
        toResponse(
          await tools.firstHalf({
            listed,
            toolCallId: randomUUID(),
            toolName,
            input: { orderId: id },
          }),
        ),
      );
    });
  firstHalfRoute('/api/orders/:id/cancel', 'cancel_order');
  firstHalfRoute('/api/orders/:id/respond', 'respond_to_order_update');

  app.post('/api/orders/:id/answer', { config: { access: 'space' } }, async (request) => {
    const { id } = OrderParams.parse(request.params);
    const body = answerBody.parse(request.body);
    return withServicesTool(request, body.toolName, async (tools, listed) =>
      toResponse(
        await tools.answer({
          listed,
          toolCallId: randomUUID(),
          toolName: body.toolName,
          input: { orderId: id },
          requestState: body.requestState,
          answer: { action: body.action, content: body.content },
        }),
      ),
    );
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
