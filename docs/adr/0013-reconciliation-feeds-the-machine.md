# 0013: Reconciliation reads Stripe and the holds, and writes only through the Order machine

**Status:** accepted, 2026-10-23 (ticket 34)

## Context

Stripe's webhooks are the source of payment truth (ADR 0012), but a webhook can be lost. A lost `checkout.session.completed` lost the booking of a guest who paid in time. A lost `payment_intent.canceled` left an Order `confirming` with an authorization Stripe had already cancelled. A confirm job that ran out of retries kept seats held for good, because the hold timer is stale for an authorized Order. A lost timer, or a restore from backup, can leave a hold `held` past its expiry. Spike S2 showed that without a periodic check the property test fails on the lapse.

## Decision

- A `reconcile` job runs every 5 minutes on a pg-boss `singleton` queue, so two runs never overlap. The admin's **Run now** enqueues the same job from the back-office API; the Stripe calls stay in the jobs process.
- It only reads Stripe: Checkout Sessions, payment intents and refunds of attempts Fetivi still considers unsettled (oldest `updated_at` first, 500 per run), and the recent sessions of each connected account. The one exception is replaying a create whose response was lost, under its original idempotency key, and only once its `expires_at` is past, so Stripe replays it or rejects it and never makes a new session.
- What it finds is fed through the Order machine's existing payment transitions with the trigger `reconciliation`. It never writes `orders.status` or `orders.payment_status` itself.
- A `held` hold past its expiry is resolved under the Order lock: an unpaid `confirming` Order is expired (2 minutes of grace), an authorized one is failed with an admin flag (30 minutes of grace for the confirm job), and a stray hold on a final, awaiting or superseded proposal is released through the adapter. A hold on a `confirmed` Order is only reported.
- A lapse on a `confirming` Order fails it, releases its hold and flags the admin, on the webhook path too (`recordVoided`). A completion that arrives after the intent's cancel takes the same path, so a cancelled authorization never confirms an Order.
- A Stripe session that carries a Fetivi attempt id no attempt row has (after a restore) is reported, never voided: a Provider with a full dashboard may hold other money on the account.
- Every disagreement is stored as a reconciliation finding. One that needs attention is updated in place while it stays open, and the admin can mark it resolved.

## Consequences

- A lost completion is usually caught while the 30-minute hold is still live, so the guest keeps the booking.
- Without `STRIPE_SECRET_KEY`, or while Stripe is unavailable, the holds are still checked; the run records `stripe-not-configured` or `stripe-unavailable`.
- `unsettledAttempts` re-reads every `requires_capture` intent on each run. With more than 500 unsettled attempts the newest wait for a later run; that is far above Fetivi's volume.
- Live-engine holds are released through the same adapter release until ticket 37 adds an engine lookup.
