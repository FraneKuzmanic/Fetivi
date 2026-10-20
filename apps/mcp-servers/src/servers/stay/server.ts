import {
  type Db,
  type GuestIdentity,
  loadGuestProjection,
  ProjectionRuleError,
} from '@fetivi/domain';
import { McpServer, ResourceNotFoundError } from '@modelcontextprotocol/server';
import { SERVER_VERSION } from '../empty';

export const UNIT_RESOURCE_URI = 'fetivi://stay/unit';

/**
 * The `stay` server for one guest. The resource URI carries no ids: the unit and Stay come only
 * from the token. Message tools arrive with ticket 23.
 */
export function buildStayServer(
  identity: GuestIdentity,
  deps: { db: Db; now: () => Date },
): McpServer {
  const server = new McpServer(
    { name: 'fetivi-stay', version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );
  server.registerResource(
    'unit',
    UNIT_RESOURCE_URI,
    {
      title: 'Your unit',
      description:
        'The unit record as this guest may see it now: arrival details and codes only after their release time.',
      mimeType: 'application/json',
    },
    async (uri) => {
      // Re-checked here as well as at the gate, so a later gate change cannot open the resource.
      if (!identity.scopes.includes('unit:read')) throw new ResourceNotFoundError(uri.href);
      try {
        const projection = await loadGuestProjection(deps.db, {
          unitId: identity.unitId,
          stayId: identity.stayId,
          language: identity.language,
          now: deps.now(),
        });
        return {
          contents: [
            { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(projection) },
          ],
        };
      } catch (error) {
        if (error instanceof ProjectionRuleError) throw new ResourceNotFoundError(uri.href);
        throw error;
      }
    },
  );
  return server;
}
