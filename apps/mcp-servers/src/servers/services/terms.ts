import type { CancellationTerms, PaymentMode } from '@fetivi/domain';

// The cancellation terms in English for the elicitation one-liners; the cards localise the same
// rule. A guest who pays the provider directly never hears "refund": no card is held by Fetivi.

const at = (local: string) => local.replace('T', ' ');

/** One sentence from the stored terms; empty when the draft has none. */
export function termsSentence(terms: CancellationTerms | null, mode: PaymentMode): string {
  if (!terms) return '';
  const late = terms.lateChargePercent;
  if (late === 0) return 'Cancelling is free at any time.';
  if (mode === 'direct') {
    const share = late === 100 ? 'the full price' : `${late} % of the price`;
    return terms.freeWindowPassed
      ? `The provider's late-cancellation terms apply: they may ask for ${share} directly.`
      : `Free cancellation until ${at(terms.freeUntilLocal)}; after that the provider may ask for ${share} directly.`;
  }
  const back = 100 - late;
  const refund = back === 0 ? 'nothing is refunded' : `${back} % of what you paid is refunded`;
  return terms.freeWindowPassed
    ? `Free cancellation has ended: ${refund}.`
    : `Free cancellation until ${at(terms.freeUntilLocal)}; after that ${refund}.`;
}
