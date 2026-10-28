# 0027: Cancellation wording follows payment mode and payment status

**Status:** accepted, 2026-10-28 (ticket 57)

## Context

The model read the provider's free-text `cancellationPolicy` and the order cards printed it. A seeded pay-direct offer said "after that 50 % is refunded", so the model promised refunds for orders where Fetivi holds no money at all. Nothing tied refund talk to how, or whether, the guest paid.

## Decision

- **Terms come from the snapshotted rule, never from the text.** The model and the cards get `cancellation: { freeCancelHoursBefore, lateChargePercent }` (late charge = 100 − `refundPercentAfter`), and on orders and card drafts also `freeUntil`, `freeUntilLocal` and `freeWindowPassed`. `refundPercentAfter` is never exposed. The provider's text still reaches the model, described as the provider's own words; the cards no longer show it.
- **Three wordings, one rule.** Pay-direct: free until the deadline, then the provider may ask for the late charge directly; never "refund". Pay-online with a payment authorized or captured: refund wording. Pay-online with nothing paid yet (the confirmation card, an Order waiting on new terms, an unpaid cancel): the late charge is a cost, never a refund; the cancel card shows no terms then, since cancelling costs nothing. The rule lives in `cancellationTermsText` (cards, 7 locales) and `termsSentence` (the English elicitation lines).
- **A pay-direct cancel re-asks when the free window closes** between card and tap, like a changed refund, unless the late charge is 0 %.

## Rejected

- Keeping the provider's text on the cards as "the provider's terms": nothing marks text the structured fields cannot express, and the seeded texts contradicted them.
- Exposing `refundPercentAfter`: its name invites refund talk for pay-direct.

## Consequences

- Drafts and receipts stored before ticket 57 have `cancellation: null` and show no terms line.
- Existing dev databases keep the old seeded policy texts (seeds are create-once); only the model sees them.
