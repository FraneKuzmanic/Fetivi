# 0021: Retention deletes the Space and keeps an Order ledger

**Status:** accepted, 2026-10-24 (ticket 45)

## Context

PRD §6.5 promises that a guest's conversation, preferences and personal data go 30 days after checkout, while commission accounting must keep each Order's essentials for 11 years (architecture §4.2). Every guest table already cascades from `spaces`: conversations and messages, About me, plan items, saved places, handoff messages, notifications, push subscriptions, tokens, pending records and Orders with their proposals, events, attempts and holds. Some guests may agree to keep their conversation for the thesis evaluation.

## Decision

- **A daily job deletes the whole Space** once `readOnlyEndsAt(closed_at)` has passed (`RETENTION_CRON`, 02:30 UTC, in pages of 100, one transaction per Space). The cascade removes everything that hangs off it, including tables later tickets add.
- **Each Order first leaves one `order_ledger` row**: Offer id and title, Provider id and name (or the host id for an own service), date, start, quantity, price, currency, payment mode, commission rate, both statuses, the guest's email and the Order's created time. `keep_until` is the Space's `closed_at` plus 11 years, and the same job purges rows past it. The table has no foreign keys.
- **A Space with an unsettled Order is held**: any non-final Order status, or a payment status other than none, captured, voided, refunded or failed. It is counted in the job's log line and tried again the next day, so nothing Stripe or a Provider may still act on is deleted.
- **Opted-in conversations are copied** into `kept_conversations` before the delete: only the guest's and Fetivi's chat messages, keyed by the opaque conversation id. System notes (they carry About me), inbox items and the email are not copied.
- **Aggregate counts survive**: `turn_metrics.conversation_id` loses its foreign key, like `answer_feedback`.

## Rejected

- Scrubbing personal columns table by table and keeping the rows: every new table would need its own list, and a missed column would keep personal data silently.
- Deleting a Space whose Order is still unsettled: a late Stripe webhook or Provider answer would find nothing, and the refund or capture would be lost.

## Consequences

- Host and admin Order pages no longer find Orders older than checkout plus 30 days; the ledger keeps the accounting record, and those pages are for live operations.
- The host inbox loses the guest's handoff messages after 30 days, by design.
- A reconciliation finding keeps its row with `order_id = null`.
- An Order whose completion timer was lost stays `confirmed` and holds its Space every day; the `held` count in the log makes it visible.
