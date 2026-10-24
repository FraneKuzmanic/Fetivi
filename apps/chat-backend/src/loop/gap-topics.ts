import { GAP_TOOL_NAME, GAP_TOPICS } from '@fetivi/domain';
import { type ToolSet, tool } from 'ai';
import { z } from 'zod';

/**
 * The silent host-side tool that notes a property fact Fetivi could not answer (44 AC 1). Its
 * only input is an enum topic, so guest wording cannot reach the stored part (44 AC 4). The
 * guest sees nothing; appendTurn turns the stored call into a content gap for the Stay.
 */
export function gapTools(): ToolSet {
  return {
    [GAP_TOOL_NAME]: tool({
      description:
        "Note that the guest asked about a fact of this property that the information from the host does not cover, so the host can add it. Call it in the same response in which you tell the guest you don't have that information, with the closest topic. Topics: supplies = towels, bed linen, toiletries; amenities = equipment such as a hair dryer, iron or cot; kitchen_appliances, laundry, heating_cooling, hot_water, pool_outdoor = how to use them; shared_spaces = spaces shared with other guests. Never for local or general questions, never when details are only waiting to be released before arrival. The guest does not see it.",
      inputSchema: z.object({ topic: z.enum(GAP_TOPICS) }),
      execute: async () => ({ noted: true }),
    }),
  };
}
