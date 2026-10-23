# 0015: A pay-online on-request Order is paid before the Provider is asked

**Status:** accepted, 2026-10-23 (ticket 36)

## Context

On-request Offers need the Provider's yes. The architecture says authorization always precedes confirmation, and ADR 0001 caps the response window under 4 days so a card authorization (7 days online) outlasts it. Two orders of events were possible for a priced pay-online Order: pay, then ask the Provider; or ask, then pay after the Provider's Accept.

Paying after the Accept needs a new state between "Provider said yes" and "guest paid". The Provider would keep a slot for an unpaid guest, and the guest could walk away after the Provider committed.

A Provider (or the admin, after a phone call) may also answer with new terms: another time, or a price for a request-kind Offer that had none. The guest then accepts or declines them in chat.

## Decision

- A priced pay-online on-request Order on the Offer's own terms goes `confirming`: a Checkout and a capacity-free hold, as for an allotment Order. The authorization moves it `confirming → pending_provider` through the `ask_provider` edge, releases the checkout hold and starts the response window. An unpaid Checkout expires the Order through the existing path, and the Provider is never asked.
- A request-kind Offer (no price) asks the Provider first. The Provider's Accept with price is new terms, paid after the guest accepts them.
- Terms the Provider or the admin proposed need no second ask. The guest's yes goes to `confirming`: pay-direct is confirmed at once through the on-request adapter, pay-online after the new Checkout is authorized.
- A new proposal writes Payment status `none` in its OrderEvent and enqueues a `void` (or `expire_session` for an open Checkout) for the superseded attempt. The new proposal gets its own attempt, under keys with its version, when the guest accepts. Payment status always describes the current proposal's attempt.
- The machine computes the response deadline on entering `pending_provider`, in the property's zone, clamped to 96 h after the request, and stores it on `order_proposals.response_due_at`. The `response_window` timer re-reads it, and the Provider email and the admin page show it.

## Consequences

- The checkout, hold expiry, confirm job and reconciliation of tickets 33 and 34 serve on-request Orders unchanged. The only new edge is `ask_provider`.
- A `pending_provider` Order holds nothing, so reconciliation never reports a held hold on it.
- A Provider who declines a paid request voids an authorization the guest already gave; the guest sees the decline, not a charge.
- A late authorization webhook for a superseded attempt is mirrored and voided by the existing not-current branches.
