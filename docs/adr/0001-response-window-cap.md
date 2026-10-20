# 0001: The response window is capped by its daily hours, not by a fixed number of minutes

**Status:** accepted, 2026-10-20 (ticket 06 review)

## Context

An on-request Offer gives the Provider a response window, counted only between the Offer's daily response hours (default 30 minutes within 08:00–21:00, in the destination's zone). The decision log requires that the window always ends under 4 days after the request, because card authorizations must outlast it and there is no separate payment link.

The first version capped the setting at 5,759 counted minutes. Counted only within 13 open hours a day, that is about 7 calendar days.

## Decision

`response_window_minutes < 4 × (response_hours_to − response_hours_from)` in minutes, enforced by the `offers_response_window_check` CHECK, the admin create schema and the editor's input limit (`maxResponseWindowMinutes` in `packages/domain/src/offers/vocabulary.ts`).

The worst case is a request just after the daily hours close: it waits overnight, then needs the full window. With the window under 4 × the daily span, that case ends at most 95 h 59 min later. With 00:00–23:59 the cap is 5,755 minutes.

## Consequences

- Narrowing the hours under an existing window is refused until the window is shortened.
- A day that gains an hour at a daylight-saving change can stretch the worst case past 96 h by that hour. Ticket 36, which computes the deadline, should clamp it to 96 h after the request.
