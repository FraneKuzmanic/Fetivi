import { getAboutMe, updateAboutMe } from '@fetivi/domain';
import { type GuestToolSpec, guestTool } from '../tool';
import { aboutMeResult, getAboutMeInput, updateAboutMeInput } from './schemas';

/** The `trip` server's tools, in `tools/list` order. */
export const tripTools: readonly GuestToolSpec[] = [
  guestTool({
    name: 'get_about_me',
    config: {
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
    // Always listed; the scope is checked per call.
    listed: () => true,
    async handler(_args, identity, { db }) {
      return { aboutMe: await getAboutMe(db, identity.spaceId) };
    },
  }),
  guestTool({
    name: 'update_about_me',
    config: {
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
    listed: (identity) => identity.scopes.includes('about_me:write'),
    async handler(args, identity, { db, now }) {
      return { aboutMe: await updateAboutMe(db, identity.spaceId, args, now()) };
    },
  }),
];
