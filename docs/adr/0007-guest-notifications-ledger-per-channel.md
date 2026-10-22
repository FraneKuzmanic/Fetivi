# 0007: Guest notifications keep a ledger per channel

**Status:** accepted, 2026-10-22 (ticket 25)

## Context

A guest notification goes out on up to three channels: the in-chat inbox, email and Android web push. Each must go out exactly once, also when a job is retried or the same event arrives twice. The Order notifications already have a ledger (`order_notification_deliveries`), but it has one row per Order, proposal and kind: it marks the whole notification sent, so a failure after the inbox write but before the email would either resend the inbox message or never send the email.

The guest's reminder the evening before a booked item is also new. The Order state machine enqueues every status notification on `order-notify`, and its property test asserts the exact set of jobs there.

Notices are stored as inbox rows, and ADR 0006 notes inbox rows to the model as host replies.

## Decision

- `guest_notification_deliveries` has one row per (key, channel). Each channel inserts its row and sends inside one transaction, and commits on its own. The inbox row and its message commit together, so the inbox is strictly once. Email carries an idempotency key and push a `Topic` header derived from the same key, so a lost commit after a send collapses at the provider.
- The key is content-derived (Order, proposal and kind; handoff; space and kind) and is also the pg-boss job id, so duplicate events enqueue one job and the ledger stops any repeat.
- The Order reminder goes on a separate `guest-notify` queue, enqueued in `confirm()`'s transaction. The `order-notify` contract and the machine's property test stay exact. A reminder whose Order is no longer confirmed on the same proposal is dropped at send time.
- Notices never reach the model: the turn notes only `host-reply` inbox items. The guest app words each notice from its facts in the current language.

## Consequences

- A failed email or push retries without repeating the inbox message.
- Email and push are exactly once up to the provider's idempotency window (24 h for Resend); pg-boss retries finish well inside it.
- New kinds (safety alerts, suggestions) add a key format and a row per channel, nothing else.
