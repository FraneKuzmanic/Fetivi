# 0014: The refund amount is decided by the cause of the cancel and stored on the payment attempt

**Status:** accepted, 2026-10-23 (ticket 35)

## Context

Until 33 a captured Order was refunded only in full, on a Provider or admin cancel. Guests now cancel in chat, and the refund must follow the Refund rule snapshotted on the Order: free until a number of hours before the start, then a percentage. The admin must be able to give a different amount. Stripe's idempotency rejects a reused key with different parameters, so a refund job that recomputed the amount on a retry after the cutoff passed would send a new `amount` under the old key and fail.

## Decision

- The amount is decided by the cause of the release: a guest cancel refunds the policy amount, a Provider's "Can't fulfil" refunds in full, an admin cancel refunds in full unless the admin overrides it. Every other path (a capture that lost a race to a cancel, reconciliation) keeps the full amount.
- The amount is computed in the domain halves and passed to the machine as `refundMinor`. The machine stores it on the attempt (`refund_amount_minor`) in the cancel's transaction, before the refund job runs. The job sends that stored amount, so every retry is the same request under the same key.
- Every refund carries `refund_application_fee: true`. Stripe returns Fetivi's fee in proportion to the amount refunded.
- A refund of 0 makes no Stripe call: the Order is `cancelled` and its Payment stays `captured`. That money is the Provider's under the policy. The admin can still refund it afterwards, once.
- An authorized Order that is cancelled before its capture is voided in full, whatever the policy. A guest is never charged money that was not captured. The window is the seconds between confirm and the capture job.
- There is one refund per attempt. A further refund (topping up a partial one) is made in the Provider's Stripe dashboard. That keeps the refund key unique and makes any `charge.refunded` with `amount_refunded > 0` mean "our refund succeeded".
- The guest's card shows the amount computed when the card was opened. The tap recomputes it; if it changed (the cutoff passed while the card was open), the card comes back with the new amount and nothing is cancelled.

## Consequences

- A cancelled Order can hold captured money. The property test's P2 and P3 allow it only when the attempt's refund amount is 0.
- A Provider refunding in its own dashboard on a captured Order maps to `refunded` too. That matches what the money did.
- The admin's override and refund are OrderEvents with trigger `admin`, the admin's id and a note naming the amount.
