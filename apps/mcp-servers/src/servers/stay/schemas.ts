import { HANDOFF_LIMITS, HANDOFF_REASONS, HANDOFF_URGENCIES } from '@fetivi/domain';
import { z } from 'zod';

const message = z
  .string()
  .trim()
  .min(1)
  .max(HANDOFF_LIMITS.messageChars)
  .describe(
    "The message to the host in the guest's language, written for the guest from what they said; no greeting needed",
  );
const urgency = z
  .enum(HANDOFF_URGENCIES)
  .describe(
    "urgent only when it cannot wait for the host's next check: a leak, a power cut, no water, a broken lock, locked out",
  );

export const draftHostMessageInput = z.object({
  reason: z
    .enum([...HANDOFF_REASONS, 'emergency'])
    .describe(
      'property_question: about the unit and not in the unit record; problem; request: something only the host can do; guest_asked: the guest wants to contact the host; emergency: danger to people (someone hurt, fire, smoke, sparks, a smell of gas, a person missing); a leak, power cut or lockout is a problem with urgency urgent, not an emergency',
    ),
  message,
  urgency,
});

const draft = z.object({ message: z.string(), reason: z.enum(HANDOFF_REASONS), urgency });

// A flat object: exactly one of `draft` and `emergency` is set.
export const draftHostMessageOutput = z.object({
  outcome: z.enum(['draft', 'emergency']),
  draft: draft.nullable(),
  emergency: z
    .object({
      emergencyNumber: z.literal('112'),
      /** Null before the arrival details are released, or when the host gave none. */
      hostPhone: z.string().nullable(),
      emergencyContactName: z.string().nullable(),
      emergencyContactPhone: z.string().nullable(),
      /** When the gated contacts appear; null once released. */
      releaseAt: z.string().nullable(),
      timezone: z.string(),
    })
    .nullable(),
});

export const sendHostMessageInput = z.object({
  message,
  reason: z.enum(HANDOFF_REASONS),
  urgency,
});

export const sendHostMessageOutput = z.object({
  outcome: z.enum(['sent', 'not_sent']),
  message: z
    .object({
      id: z.string(),
      text: z.string(),
      urgency: z.enum(HANDOFF_URGENCIES),
      sentAt: z.string(),
    })
    .nullable(),
});
