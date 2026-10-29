# 0028: Requests are free to cancel until they are accepted

**Status:** accepted, 2026-10-29 (ticket 62)

## Context

For an Offer without slots the free cancellation cutoff counted back from midnight of the order date. A next-day request sent after midnight (olive oil, a transfer) was "late" before the Provider or host had even seen it, and the card told the guest that cancelling already cost money. An on-request Order is a question until someone says yes, so charging for withdrawing it was wrong.

## Decision

- **Free until accepted.** An on-request Order (booking, request or purchase) is free to cancel while it is awaiting confirmation, confirming or pending the provider. `CancellationTerms.awaitingAcceptance` names who has to accept (`provider`, or `host` for an own service) and `freeWindowPassed` stays false meanwhile. The draft card, the receipt, `list_my_orders`, the cancel card and `termsSentence` all say "free until the provider/host accepts".
- **After acceptance the usual cutoff applies,** counted from the proposal's start: the time the Provider accepted, or the guest's requested time, which is stored as the first proposal's `starts_at`.
- **No new grace period.** When an Order is accepted after its cutoff (with a late charge above 0 %), the guest's `order_confirmed` email and in-chat notice say cancelling is no longer free. The push text is unchanged.
- **Allotment Orders are unchanged.** They are confirmed at the tap, so the old rule already fits.
- **Money paths are unchanged.** Before acceptance a pay-direct Order holds nothing and a pay-online one is at most authorized, which a cancel voids in full (ADR 0014, 0015). `refundFor` is untouched.

## Rejected

- Restarting the free window at acceptance: a Provider accepting late would hand the guest a free window the Provider never agreed to.
- A separate `orders.requested_time` column: every reader of the start (Provider page, emails, host inbox, receipts, response window, cutoff, reminders) would have to learn a second field.

## Consequences

- Drafts and stored chat parts from before this ticket parse with `awaitingAcceptance: null` and keep their old wording.
- A cancel card shown while awaiting re-asks if the Provider accepts after the cutoff before the guest taps, because the terms changed.
