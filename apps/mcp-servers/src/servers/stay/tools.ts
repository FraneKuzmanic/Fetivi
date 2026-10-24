import { assertCanHandOff, loadGuestProjection } from '@fetivi/domain';
import { type GuestToolSpec, guestTool } from '../tool';
import { refusingHandoff } from './host-message';
import {
  draftHostMessageInput,
  draftHostMessageOutput,
  sendHostMessageInput,
  sendHostMessageOutput,
} from './schemas';

const listed = (identity: { scopes: readonly string[] }) =>
  identity.scopes.includes('host_message:send');

/**
 * draft_host_message: the read-only gate before any card. It refuses once a message was sent,
 * and in an emergency answers 112 and the host's phone instead of a draft.
 */
export const draftHostMessageSpec: GuestToolSpec = guestTool({
  name: 'draft_host_message',
  config: {
    title: 'Draft a message to the host',
    description:
      "Prepare a message to the host. Use it only for a question about the unit that the unit record does not answer, a problem, a request for the host, or when the guest asks to contact the host; never for local questions (places, food, transport, events). Offer it, don't push it; if the guest declines, don't offer again unless they ask. For an emergency (injury, fire, someone in danger) pass reason emergency: no message is drafted; tell the guest to call 112 first; the contacts card is shown, so do not also call show_property_info. Otherwise call send_host_message with the draft.",
    scope: 'host_message:send',
    inputSchema: draftHostMessageInput,
    outputSchema: draftHostMessageOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  listed,
  async handler(args, identity, { db, now }) {
    if (args.reason === 'emergency') {
      // The guest projection gates the host's phone before the arrival release, as in the Guide.
      const p = await loadGuestProjection(db, {
        unitId: identity.unitId,
        stayId: identity.stayId,
        language: identity.language,
        now: now(),
      });
      return {
        outcome: 'emergency' as const,
        draft: null,
        emergency: {
          emergencyNumber: '112' as const,
          hostPhone: p.contacts.hostPhone,
          emergencyContactName: p.contacts.emergencyContactName,
          emergencyContactPhone: p.contacts.emergencyContactPhone,
          releaseAt: p.stay.arrivalDetailsHeldBack ? p.stay.arrivalDetailsReleaseAt : null,
          timezone: p.property.timezone,
        },
      };
    }
    await refusingHandoff(() => assertCanHandOff(db, identity.spaceId));
    return {
      outcome: 'draft' as const,
      draft: { message: args.message, reason: args.reason, urgency: args.urgency },
      emergency: null,
    };
  },
});

/** send_host_message: its two halves live in host-message.ts, since the guest confirms between them. */
export const sendHostMessageSpec: GuestToolSpec = guestTool({
  name: 'send_host_message',
  config: {
    title: 'Send a message to the host',
    description:
      'Show the guest the drafted message on a card they can edit; nothing reaches the host until the guest taps Send. Never say the message was sent without a `sent` outcome, and never say the host has seen or read it.',
    scope: 'host_message:send',
    inputSchema: sendHostMessageInput,
    outputSchema: sendHostMessageOutput,
    // It only adds a message, after the guest's tap; it reaches the host.
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  listed,
  confirm: true,
});

/** The `stay` server's tools, in `tools/list` order. */
export const stayTools: readonly GuestToolSpec[] = [draftHostMessageSpec, sendHostMessageSpec];
