import {
  type GuestIdentity,
  loadGuestProjection,
  ProjectionRuleError,
  UNIT_RESOURCE_URI,
} from '@fetivi/domain';
import { McpServer, ResourceNotFoundError } from '@modelcontextprotocol/server';
import { CONFIRM_TOOLS, registerConfirmTool } from '../confirm';
import { registerGuestTools, type ToolDeps } from '../tool';
import { SERVER_VERSION } from '../version';
import { stayTools } from './tools';

/**
 * The `stay` server for one guest: the unit record and the Host message tools. The resource URI
 * carries no ids: the unit and Stay come only from the token. The message tools are listed while
 * the token carries host_message:send, so not after checkout.
 */
export function buildStayServer(identity: GuestIdentity, deps: ToolDeps): McpServer {
  const sendHostMessage = CONFIRM_TOOLS.send_host_message;
  const codec = sendHostMessage.codec(deps.requestStateSecret, identity.spaceId);
  const server = new McpServer(
    { name: 'fetivi-stay', version: SERVER_VERSION },
    // A tampered, expired or other tool's requestState dies here with -32602.
    {
      capabilities: { tools: {}, resources: {} },
      requestState: { verify: (state) => codec.verify(state) },
    },
  );
  registerGuestTools(server, identity, deps, stayTools);
  if (sendHostMessage.spec.listed(identity)) {
    registerConfirmTool(server, identity, deps, sendHostMessage, codec);
  }
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
