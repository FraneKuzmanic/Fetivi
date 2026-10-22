# 0009: A recovery link moves the Space to the new device

**Status:** accepted, 2026-10-22 (ticket 26)

## Context

A Space lives in one httpOnly cookie on one device. Clearing the browser, switching phones or losing the phone loses it, and after checkout the PIN no longer opens anything. Ticket 26 lets a guest who gave an email get back in by a link sent to that email, from the PIN screen or from Settings, on any device and also during the 30-day read-only period after checkout.

The cookie holds a random token whose hash is `spaces.token_hash`; `resolveSpace` looks a Space up by that one hash. The glossary calls a Space "one device's private world".

## Decision

- Opening a recovery link moves the Space: the cookie token rotates, the new device gets the cookie, and the old device's cookie stops resolving, so it signs out. The Space's push subscriptions are removed, because they belong to the old device. The Space keeps its Stay, Conversation, Orders and About me.
- Recovery needs only an opted-in email, not a verified one. Opening the link proves the address, so it also marks the email verified while it is still the Space's current email.
- Links are single-use, hashed tokens in `space_tokens` (`recover` for 1 hour, `verify_email` for 24 hours), deleted with the Space. The jobs process sends them on the `space-email` queue and makes the token at send time, so pg-boss never stores a live link. A retried job sends with the same idempotency key.
- The PIN-screen request answers the same for any email at a working link and picks the latest-created opted-in Space of that unit still inside the read-only period.

## Considered and rejected

- Several cookie tokens per Space (a device table): two devices could share one Space, against "one device's private world", and a lost phone would stay signed in.
- Copying the Space into a new one: Orders, the Conversation and About me would diverge or have to move.

## Consequences

- A guest can only be on one device at a time; Settings says that opening the link on the other device signs this one out.
- Updates other than Order mails go only to a verified email. Emails given on an Order card before this ticket never got a confirmation link, so migration 0030 counts them as verified from their opt-in time rather than silently stopping their updates.
- The lookup by cookie hash stays as it is.
- Ticket 45's retention deletes `space_tokens` with the Space.
