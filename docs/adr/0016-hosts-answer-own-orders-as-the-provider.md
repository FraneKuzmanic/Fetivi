# 0016: A host answers the Orders on their own services as the Provider

**Status:** accepted, 2026-10-23 (ticket 38)

## Context

Hosts can now list their own services (an Offer with `offers.host_id` and no Provider). Their Orders follow the same machine as Provider Orders: an on-request Order waits for an answer, an allotment Order waits for Got it, and either side may propose new terms. A Provider answers on the per-order link (ticket 15). A host already has a back-office login and an inbox (ticket 23).

The open questions were how the host's answers are recorded, where the host's card payments go, and where a host's Provider suggestion lands before the curation queue (ticket 39) exists.

## Decision

- The host plays the Provider of their own Offers. The back office shows the same `providerLinkView` and its actions (Got it, Can't fulfil, Accept, Decline, Suggest another time, Accept with price), bound to the current proposal, in an Orders section of `/inbox`.
- Each answer is recorded with the OrderEvent trigger `provider_link` and the signed-in account (the host, or an admin acting as them) as `actor_id`. There is no new trigger.
- The host is told by an English email linking to `/inbox`, sent once per ask through `deliverOnce`. No Provider link token is issued for an own-service Order.
- A host's own Stripe connected account lives on `accounts` (`stripe_account_id`, `stripe_card_payments`, `stripe_checked_at`), onboarded like a Provider's (ticket 33). `merchantOf` resolves the Provider's or the host's account. The host is merchant of record, the commission is 0 and the capture sends no application fee.
- `curation_items` and `enqueueCurationItem` are created here with ticket 39's kinds and statuses, so a host's Provider suggestion is a real queue item from the start.

## Rejected

- A separate `host` trigger: it would touch every transition-table entry and the property test for no difference in behaviour. `actor_id` already says who answered.
- Routing host Orders through emails with a link token: the host already has a login, and the inbox keeps the answers next to the guest messages.

## Consequences

- The machine and the transitions are unchanged; the provider-link suite covers the host's actions too.
- A missed response window on an own service still alerts the admins, as for a Provider.
- Ticket 39 extends `CurationPayload` and builds the queue screen on the existing table.
