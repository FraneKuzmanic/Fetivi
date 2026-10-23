export type FallbackQueryReason = 'shape' | 'length' | 'contact' | 'digits' | 'private';

/** The web fallback query broke the payload contract; nothing was sent. */
export class FallbackQueryError extends Error {
  override name = 'FallbackQueryError';
  constructor(readonly reason: FallbackQueryReason) {
    super(reason);
  }
}

/** The web search could not answer: no key, a bad status, a network error or a bad body. */
export class WebSearchUnavailableError extends Error {
  override name = 'WebSearchUnavailableError';
}
