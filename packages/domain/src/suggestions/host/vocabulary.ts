// Content-gap Suggestions' controlled list (ticket 44). Imports only the wizard config, which is
// browser-safe, so the pgEnum is built from it and the web apps can bundle it.
import { type WizardFieldId, type WizardStepId, wizardField } from '../../property/wizard-config';

/**
 * Property facts a guest can ask for that the host may not have entered. Each is a wizard field
 * (20's stable ids), so it maps to one step and field anchor and `isFilled` resolves it. Left out:
 * the codes (arrival-gated), arrival_release and licence_number (internal), location and
 * neighbourhood_tips (local questions go through the local tools and curation gaps).
 */
export const GAP_TOPICS = [
  'address',
  'check_in_time',
  'check_in_method',
  'access_instructions',
  'arrival_directions',
  'wifi',
  'amenities',
  'parking',
  'occupancy',
  'rooms_beds',
  'supplies',
  'checkout_time',
  'house_rules',
  'quiet_hours',
  'house_rules_notes',
  'checkout_steps',
  'shared_spaces',
  'rubbish_recycling',
  'heating_cooling',
  'kitchen_appliances',
  'laundry',
  'pool_outdoor',
  'hot_water',
  'host_phone',
  'emergency_contact',
  'medical_help',
] as const satisfies readonly WizardFieldId[];
export type GapTopic = (typeof GAP_TOPICS)[number];

/** A topic reaches the host once it went unanswered in this many different Stays of a unit. */
export const MIN_GAP_STAYS = 2;

export const isGapTopic = (v: unknown): v is GapTopic =>
  typeof v === 'string' && (GAP_TOPICS as readonly string[]).includes(v);

/** The wizard step and field a topic's Suggestion links to. */
export const gapTarget = (topic: GapTopic): { stepId: WizardStepId; fieldId: GapTopic } => ({
  stepId: wizardField(topic).step,
  fieldId: topic,
});
