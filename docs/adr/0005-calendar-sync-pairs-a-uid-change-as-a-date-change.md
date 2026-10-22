# 0005: Calendar sync pairs a UID change with a date change

**Status:** accepted, 2026-10-22 (ticket 22)

## Context

Calendar sync matches events across polls by their iCal UID. Airbnb keeps the UID when a booking's dates change. For Booking.com it is not known (PRD §9 lists it as a test to run): a date change may keep the UID, or it may remove the old event and add a new one. Booking.com's export carries only the UID, the dates and "CLOSED - Not available", so a moved booking with a new UID looks exactly like a cancellation plus an unrelated new booking or block.

If a new UID were always read as a new booking, every Booking.com date change would mark the confirmed Stay possibly cancelled and propose the new dates again, and the host would have to sort out both by hand.

## Decision

The sync planner (`packages/domain/src/calendar/reconcile.ts`) handles both behaviours:

- A kept UID with new dates is a plain date change: the Stay moves through `updateStay`, the PIN stays, and the host gets one email.
- A changed UID is read as a date change only when, in one poll of one feed, **exactly one** confirmed event of an active Stay vanished and **exactly one** new usable event appeared. The new event is linked to that Stay, the old event row is deleted instead of marked vanished, and the Stay moves if the dates differ.
- Anything more ambiguous (two vanished, two new, or a vanished event whose Stay already ended) is not paired. The Stay is marked possibly cancelled (when it has not started yet) and the new event becomes a proposal. The host decides.

## Consequences

- A real cancellation and an unrelated new booking or block on the same feed within one 30-minute poll are read as a move. The date-change email makes that visible, and the host can fix the Stay's dates or cancel it.
- The fallback is safe: a possibly cancelled Stay's PIN keeps working until the host acts, so no guest is locked out by a wrong guess.
- Once the PRD §9 test shows what Booking.com does, the pairing rule can stay as is (it is harmless when the UID is kept) or be narrowed.
