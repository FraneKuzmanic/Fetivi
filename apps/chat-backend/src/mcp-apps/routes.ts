import type { FastifyPluginAsync } from 'fastify';
import { HttpError } from '../http-error';
import {
  type Ferryhopper,
  ToolBlockedError,
  WidgetNotFoundError,
} from '../mcp/external/ferryhopper';
import { callBody, widgetQuery } from './schemas';

// The guest app's side of Ferryhopper's widgets (MCP Apps). The browser never talks to Ferryhopper:
// the widget's HTML and the tool calls it makes go through here, so the pin policy holds for both.
// A widget outlives its turn, so its calls are not part of one and count in no turn metrics.
export const mcpAppRoutes: FastifyPluginAsync<{ ferryhopper: Ferryhopper | null }> = async (
  app,
  { ferryhopper },
) => {
  /** A widget's HTML and the CSP its server declares, for the sandbox to serve. */
  app.get(
    '/api/mcp-apps/ferryhopper/widget',
    { config: { access: 'space' } },
    async (request, reply) => {
      const { uri } = widgetQuery.parse(request.query);
      if (!ferryhopper) throw new HttpError(404, 'widget-not-found');
      try {
        const widget = await ferryhopper.readWidget(uri);
        // Cached by URI and pin hash on the server too; a changed pin gets a new widget there.
        reply.header('cache-control', 'private, max-age=86400');
        return widget;
      } catch (error) {
        if (error instanceof WidgetNotFoundError) throw new HttpError(404, 'widget-not-found');
        request.log.warn({ err: error }, 'ferryhopper widget unavailable');
        throw new HttpError(502, 'widget-unavailable');
      }
    },
  );

  /** A tool call a widget makes, under the same pin as the model's calls. */
  app.post('/api/mcp-apps/ferryhopper/call', { config: { access: 'space' } }, async (request) => {
    const body = callBody.parse(request.body);
    if (!ferryhopper) throw new HttpError(403, 'tool-blocked', { reason: 'not-pinned' });
    try {
      return await ferryhopper.call(body.name, body.arguments, 'app');
    } catch (error) {
      if (error instanceof ToolBlockedError) {
        throw new HttpError(403, 'tool-blocked', { reason: error.reason });
      }
      request.log.warn({ err: error }, 'ferryhopper widget call failed');
      throw new HttpError(502, 'tool-unavailable');
    }
  });
};
