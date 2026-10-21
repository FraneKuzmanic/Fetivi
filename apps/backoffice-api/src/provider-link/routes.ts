import {
  acknowledgeOrder,
  cannotFulfil,
  type Db,
  findOrderByLinkToken,
  type JobQueue,
  PROVIDER_DEFAULTS,
  PROVIDER_LANGUAGES,
  type ProviderLanguage,
  providerLinkView,
  type TransitionOutcome,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  FLASHES,
  type Flash,
  renderBadRequest,
  renderCannotFulfilConfirm,
  renderNotFound,
  renderProviderPage,
} from './page';

// The Provider's per-order page: public, no login, the token is the only key. GET never writes
// (mail scanners prefetch links); actions are plain form posts answered by a 303 back to the page.
// The global origin check on /api/ writes is the CSRF guard.

export interface ProviderLinkDeps {
  db: Db;
  queue: JobQueue;
  now: () => Date;
}

const Lang = z.enum(PROVIDER_LANGUAGES);
const Params = z.object({ token: z.string() });
const Query = z.object({
  lang: Lang.optional().catch(undefined),
  done: z.enum(FLASHES).optional().catch(undefined),
});
const Body = z.object({
  action: z.enum(['acknowledge', 'cannot_fulfil', 'cannot_fulfil_confirmed']),
  proposalId: z.uuid(),
  lang: Lang.optional().catch(undefined),
});

/** The token travels in the URL, so the page is never cached, indexed, framed or referred. */
function html(reply: FastifyReply, status: number, body: string) {
  return reply
    .status(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'same-origin')
    .header('x-robots-tag', 'noindex')
    .header('x-frame-options', 'DENY')
    .header(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    )
    .send(body);
}

function flashOf(action: 'acknowledge' | 'cannot_fulfil_confirmed', result: TransitionOutcome) {
  if (result.outcome !== 'applied') return result.outcome;
  return action === 'acknowledge' ? 'acknowledged' : 'cancelled';
}

export async function providerLinkRoutes(
  app: FastifyInstance,
  deps: ProviderLinkDeps,
): Promise<void> {
  const publicRoute = { config: { access: 'public' as const } };
  // Scoped to this plugin: form posts are accepted only here.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  const pathOf = (token: string) => `/api/provider-link/${encodeURIComponent(token)}`;

  app.get('/api/provider-link/:token', publicRoute, async (request, reply) => {
    const { token } = Params.parse(request.params);
    const query = Query.safeParse(request.query);
    const lang = query.success ? query.data.lang : undefined;
    const found = await findOrderByLinkToken(deps.db, token);
    if (!found) return html(reply, 404, renderNotFound(lang ?? PROVIDER_DEFAULTS.language));
    const view = providerLinkView(found);
    const pageLang: ProviderLanguage = lang ?? view.language;
    const flash: Flash | undefined = query.success ? query.data.done : undefined;
    return html(reply, 200, renderProviderPage(view, pageLang, pathOf(token), flash));
  });

  app.post('/api/provider-link/:token', publicRoute, async (request, reply) => {
    const { token } = Params.parse(request.params);
    const body = Body.safeParse(request.body);
    const lang = body.success ? body.data.lang : undefined;
    const found = await findOrderByLinkToken(deps.db, token);
    if (!found) return html(reply, 404, renderNotFound(lang ?? PROVIDER_DEFAULTS.language));
    const view = providerLinkView(found);
    const pageLang = lang ?? view.language;
    if (!body.success) return html(reply, 400, renderBadRequest(pageLang));

    const { action, proposalId } = body.data;
    const ref = { orderId: view.orderId, proposalId };
    const back = (flash: Flash) =>
      reply.redirect(`${pathOf(token)}?lang=${pageLang}&done=${flash}`, 303);

    if (action === 'cannot_fulfil') {
      // The confirmation step writes nothing.
      if (proposalId !== view.proposalId) return back('stale');
      if (!view.actions.includes('cannot_fulfil')) return back('rejected');
      return html(reply, 200, renderCannotFulfilConfirm(view, pageLang, pathOf(token)));
    }
    const result =
      action === 'acknowledge' ? await acknowledgeOrder(deps, ref) : await cannotFulfil(deps, ref);
    return back(flashOf(action, result));
  });
}
