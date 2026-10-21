import { type Db, listSavedPlaceIds, loadSituation, type SpaceContext } from '@fetivi/domain';
import { type PlaceCardPayload, placeCard } from '@fetivi/ui/payloads';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { spaceOf } from '../access/plugin';
import { HttpError } from '../http-error';
import type { ToolBinding, TurnTools } from '../tools/registry';

export interface GuideRouteDeps {
  db: Db;
  now: () => Date;
  tools: ToolBinding;
}

/** The most saved places the Guide shows. */
const SAVED_PLACES_SHOWN = 30;

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

/** The first sentences of a description, cut at a word, as a card's one-line summary. */
function summaryOf(description: string, max = 160): string {
  const text = description.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A get_place result as a place card; null when it does not fit the card contract. */
function cardOf(output: unknown): PlaceCardPayload | null {
  const place = isRecord(output) && isRecord(output.place) ? output.place : null;
  if (!place) return null;
  const image = isRecord(place.image) ? place.image : null;
  const parsed = placeCard.safeParse({
    ...place,
    summary: typeof place.description === 'string' ? summaryOf(place.description) : '',
    image: image
      ? {
          url: image.url,
          attribution: image.attribution,
          licence: image.licence,
          sourcePageUrl: image.sourcePageUrl,
        }
      : null,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The Guide tab reads the unit record and the saved places through the permitted tools, without
 * a model (architecture §4.3), like My trip: the authorization matrix stays the one rule.
 */
export const guideRoutes: FastifyPluginAsync<GuideRouteDeps> = async (app, deps) => {
  async function withTools<T>(
    request: FastifyRequest,
    unavailable: 'guide-unavailable' | 'saved-places-unavailable',
    use: (tools: TurnTools, ctx: SpaceContext) => Promise<T>,
  ): Promise<T> {
    const now = deps.now();
    const ctx = await loadSituation(deps.db, spaceOf(request).space.id, now);
    if (!ctx) throw new HttpError(401, 'no-space');
    let tools: TurnTools | null = null;
    try {
      tools = await deps.tools.open(ctx, now);
      return await use(tools, ctx);
    } catch (error) {
      request.log.error({ err: error }, unavailable);
      throw new HttpError(502, unavailable);
    } finally {
      await tools?.close();
    }
  }

  /** The unit record in the Space's language, as the stay server shows it now. */
  app.get('/api/unit', { config: { access: 'space' } }, async (request) =>
    withTools(request, 'guide-unavailable', async (tools) => ({
      unit: await tools.readProjection(),
    })),
  );

  /** The Space's saved places as cards, newest first. */
  app.get('/api/guide/saved-places', { config: { access: 'space' } }, async (request) => {
    const ids = (await listSavedPlaceIds(deps.db, spaceOf(request).space.id)).slice(
      0,
      SAVED_PLACES_SHOWN,
    );
    if (ids.length === 0) return { places: [] };
    return withTools(request, 'saved-places-unavailable', async (tools) => {
      const getPlace = (await tools.list()).find(
        (l) => l.server === 'local' && l.tool.name === 'get_place',
      );
      // Not listed without a destination: nothing saved can be shown.
      if (!getPlace) return { places: [] };
      const places: PlaceCardPayload[] = [];
      for (const placeId of ids) {
        try {
          const card = cardOf(await tools.call(getPlace, { placeId }));
          if (card) places.push(card);
        } catch (error) {
          // A place no longer visible (unpublished, out of scope) is left out.
          request.log.warn({ err: error, placeId }, 'saved place not shown');
        }
      }
      return { places };
    });
  });
};
