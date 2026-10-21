import { type Db, type GuestIdentity, getAboutMe, updateAboutMe } from '@fetivi/domain';
import { McpServer } from '@modelcontextprotocol/server';
import { registerGuestTool } from '../tool';
import { SERVER_VERSION } from '../version';
import { aboutMeResult, getAboutMeInput, updateAboutMeInput } from './schemas';

/**
 * The `trip` server for one guest: About me now, the day plan with ticket 27. update_about_me is
 * listed only while the token has about_me:write (before arrival and in stay). Special-category
 * needs are readable here but never writable: only the guest app's own tap stores them.
 */
export function buildTripServer(
  identity: GuestIdentity,
  deps: { db: Db; now: () => Date },
): McpServer {
  const server = new McpServer(
    { name: 'fetivi-trip', version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );
  const { db, now } = deps;

  registerGuestTool(
    server,
    identity,
    'get_about_me',
    {
      title: 'About me',
      description:
        'What the guests chose to share about their trip: who is travelling, interests, pace, budget feel, and needs they added themselves. Use it to tailor suggestions.',
      scope: 'about_me:read',
      inputSchema: getAboutMeInput,
      outputSchema: aboutMeResult,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({ aboutMe: await getAboutMe(db, identity.spaceId) }),
  );

  if (identity.scopes.includes('about_me:write')) {
    registerGuestTool(
      server,
      identity,
      'update_about_me',
      {
        title: 'Save a preference',
        description:
          'Save an ordinary preference the guest mentions in conversation (who is travelling, interests, pace, budget feel) without asking or announcing it. Never for health, diet for medical or religious reasons, religion or accessibility: those are saved only by the guest in About me.',
        scope: 'about_me:write',
        inputSchema: updateAboutMeInput,
        outputSchema: aboutMeResult,
        // It overwrites single values (party, pace, budget).
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args) => ({ aboutMe: await updateAboutMe(db, identity.spaceId, args, now()) }),
    );
  }

  return server;
}
