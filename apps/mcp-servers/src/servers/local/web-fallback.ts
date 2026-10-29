import { FallbackQueryError, WebSearchUnavailableError, webFallbackSearch } from '@fetivi/domain';
import { GuestToolError, guestTool } from '../tool';
import { webFallbackInput, webFallbackOutput } from './schemas';

/**
 * web_fallback_search: allowlisted sites through Brave, listed in every situation (inside or
 * outside a destination, also after checkout). It writes a fallback_log row per call, but the
 * guest-visible state does not change, hence readOnlyHint.
 */
/** What the model is told when the query breaks the payload contract. */
export const REPHRASE =
  "Search only with topic keywords and a place name: no names, numbers, codes, contact or booking details, and nothing about the guests. Rephrase and try once more, or say you don't have a suggestion for that.";

export const webFallbackTool = guestTool({
  name: 'web_fallback_search',
  config: {
    title: 'Web fallback search',
    description:
      "Search trusted websites only (tourist boards, ferry operators, DHMZ, venues' own sites) when search_places, search_events or get_transport_notes returned nothing for the question; outside a destination it is the only local source. Pass topic keywords and a place name only. Results are unchecked web pages, numbered by their order: cite one as [1], [2] … right after the sentence it supports. Never present them as checked recommendations, never offer to book them.",
    scope: 'web_fallback:search',
    inputSchema: webFallbackInput,
    outputSchema: webFallbackOutput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  listed: (identity) => identity.scopes.includes('web_fallback:search'),
  async handler(args, identity, { db, now, webSearch }) {
    try {
      return await webFallbackSearch(db, identity, args, webSearch, now());
    } catch (error) {
      if (error instanceof FallbackQueryError) {
        throw new GuestToolError(REPHRASE);
      }
      if (error instanceof WebSearchUnavailableError) {
        throw new GuestToolError('Web search is not available right now.');
      }
      throw error;
    }
  },
});
