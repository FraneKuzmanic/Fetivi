# 0012: Stripe webhooks land on the back-office API; Stripe writes run only in jobs

**Status:** accepted, 2026-10-23 (ticket 33)

## Context

Pay-online Orders need a public endpoint for Stripe's events (the source of payment truth) and a place to make Stripe's write calls: create the Checkout Session, capture, void, expire and refund. The chat backend serves guests only, and in V0 (ADR 0002) it also runs the tool specs in process, so any Stripe call made while booking would put the secret key in that process. The back-office API already has a raw-body webhook with a signature as its credential (`/webhooks/resend`).

## Decision

- Stripe's events arrive at `POST /webhooks/stripe` on the back-office API. The route is outside `/api/`, so it has no session and no Origin check. It is registered only when `STRIPE_WEBHOOK_SECRET` is set. It verifies the signature on the raw body, maps the event to a machine transition and makes no Stripe call. Each event id is processed once, because it is recorded on the payment attempt. Every verified event gets a 200, including one that is not ours.
- Every Stripe write runs in the jobs process, as an `order-payment` job keyed `order:<id>:proposal:<id>:payment:<operation>`; the `open` job's key also ends in `:<expires_at unix>`, so a restamped attempt gets a fresh job. The idempotency key has the form `order:<id>:proposal:<n>:<operation>:<expires_at>`, and every parameter comes from stored attempt columns, so a retry sends the identical request. `completeOrder` only enqueues the `open` job. The guest's Pay now button asks the chat backend for the stored Checkout URL.
- The back-office API also holds the key, for Provider onboarding (Accounts v2 and account links), which is an admin action.

## Consequences

- The MCP servers, the chat backend and the V0 in-process binding never hold the Stripe secret key.
- Pay now waits up to one pg-boss poll (about 2 s) before the Checkout URL exists. The guest app retries while the answer is `preparing`.
- Stripe's Connect endpoint (or `stripe listen --forward-connect-to` locally) must point at the back-office host. Caddy must route `host.<domain>/webhooks/*` to that process.
- Capability changes on connected accounts do not arrive by webhook. The admin's Refresh, and the return from onboarding, read the status.
