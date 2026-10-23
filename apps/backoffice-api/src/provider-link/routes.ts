import {
  acceptOrder,
  acknowledgeOrder,
  cannotFulfil,
  type Db,
  declineOrder,
  findOrderByLinkToken,
  type JobQueue,
  OFFER_LIMITS,
  OrderRuleError,
  PROVIDER_DEFAULTS,
  PROVIDER_LANGUAGES,
  type ProposedTerms,
  type ProviderLanguage,
  type ProviderLinkView,
  proposeOrder,
  providerLinkView,
  type TransitionOutcome,
} from '@fetivi/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  FLASHES,
  type Flash,
  type FormError,
  renderBadRequest,
  renderCannotFulfilConfirm,
  renderNewTerms,
  renderNotFound,
  renderProviderPage,
  type TermsForm,
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
  action: z.enum([
    'acknowledge',
    'cannot_fulfil',
    'cannot_fulfil_confirmed',
    'accept',
    'decline',
    'suggest_time',
    'suggest_time_confirmed',
    'accept_with_price',
    'accept_with_price_confirmed',
  ]),
  proposalId: z.uuid(),
  lang: Lang.optional().catch(undefined),
  // New terms (36): the form's raw strings, checked against the page's view below.
  date: z.string().max(10).optional(),
  time: z.string().max(5).optional(),
  price: z.string().max(16).optional(),
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Major units with up to two decimals; a comma is the Croatian decimal mark.
const PRICE = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;

/** A price typed in major units, in minor units; undefined when it is not a valid price. */
export function parsePrice(text: string): number | undefined {
  const match = PRICE.exec(text.trim());
  if (!match) return undefined;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return minor > 0 && minor <= OFFER_LIMITS.priceMinorMax ? minor : undefined;
}

/** The form's new terms, or the first field that is wrong. */
function termsOf(
  view: ProviderLinkView,
  form: TermsForm,
  priceOnly: boolean,
): ProposedTerms | FormError {
  const date = priceOnly ? view.date : form.date;
  if (!DATE.test(date) || date < view.stayFrom || date > view.stayTo) return 'date';
  const time = priceOnly ? (view.startTime ?? '') : form.time;
  if (time !== '' && !TIME.test(time)) return 'time';
  let priceMinor: number | undefined;
  if (form.price.trim() !== '' || view.needsPrice || priceOnly) {
    priceMinor = parsePrice(form.price);
    if (priceMinor === undefined) return 'price';
  }
  return { date, ...(time ? { time } : {}), ...(priceMinor !== undefined ? { priceMinor } : {}) };
}

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

const APPLIED = {
  acknowledge: 'acknowledged',
  cannot_fulfil_confirmed: 'cancelled',
  accept: 'accepted',
  decline: 'declined',
  suggest_time_confirmed: 'proposed',
  accept_with_price_confirmed: 'proposed',
} as const satisfies Record<string, Flash>;

function flashOf(action: keyof typeof APPLIED, result: TransitionOutcome): Flash {
  return result.outcome === 'applied' ? APPLIED[action] : result.outcome;
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
    if (action === 'suggest_time' || action === 'accept_with_price') {
      // The form step writes nothing.
      if (proposalId !== view.proposalId) return back('stale');
      if (!view.actions.includes(action)) return back('rejected');
      const form = { date: view.date, time: view.startTime ?? '', price: '' };
      return html(reply, 200, renderNewTerms(view, pageLang, pathOf(token), action, form));
    }
    if (action === 'suggest_time_confirmed' || action === 'accept_with_price_confirmed') {
      const step = action === 'suggest_time_confirmed' ? 'suggest_time' : 'accept_with_price';
      if (proposalId !== view.proposalId) return back('stale');
      if (!view.actions.includes(step)) return back('rejected');
      const form = {
        date: body.data.date ?? '',
        time: body.data.time ?? '',
        price: body.data.price ?? '',
      };
      const again = (error: FormError) =>
        html(reply, 400, renderNewTerms(view, pageLang, pathOf(token), step, form, error));
      const terms = termsOf(view, form, step === 'accept_with_price');
      if (typeof terms === 'string') return again(terms);
      try {
        return back(flashOf(action, await proposeOrder(deps, ref, terms)));
      } catch (error) {
        // The machine refuses terms the form can't see, such as a start that has passed.
        if (error instanceof OrderRuleError && error.code === 'invalid-input')
          return again('terms');
        throw error;
      }
    }
    const result =
      action === 'acknowledge'
        ? await acknowledgeOrder(deps, ref)
        : action === 'accept'
          ? await acceptOrder(deps, ref)
          : action === 'decline'
            ? await declineOrder(deps, ref)
            : await cannotFulfil(deps, ref);
    return back(flashOf(action, result));
  });
}
