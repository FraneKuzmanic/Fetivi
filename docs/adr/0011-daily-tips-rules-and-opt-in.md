# 0011: Daily tips are rule-picked, once a day, inbox by default

**Status:** accepted, 2026-10-23 (ticket 30)

## Context

PRD §6.5 wants Fetivi to speak up unprompted with at most one suggestion a day per Space, inbox only by default, only to Spaces used in the last 48 hours, and by email only with a separate unticked opt-in. A promotional email needs the guest's consent (ePrivacy) and, for bulk senders, a one-click unsubscribe (RFC 8058). The word "Suggestions" already names the host's content gaps, so the guest feature is called **Daily tip**.

The catalog had no way to say a place suits a rainy day, or that an event suits an interest: events have no category and places no indoor flag.

## Decision

- Rules in order, first with a candidate wins: **rain** (tomorrow's MET Norway sky is rain, heavy rain, showers or thunder → the best-ranked place or day trip ticked `rainy_day`), **event** (an event on tomorrow whose admin-ticked `interests` overlap About me → the earliest), **gap** (tomorrow is a full Stay day with nothing in the plan → the best-ranked place or day trip). Candidates keep `rankPlaces` order and skip anything already planned; nothing reads an Offer or a commission. A forecast that could not be checked skips the rain rule only.
- Wording is fixed copy in the 7 languages filled with catalog facts. No model call: a tip must never invent a place, and it costs nothing per send.
- A `daily-tips` cron (every 15 minutes) picks Spaces from 17:00 to 21:00 property time on send days (check-in to the day before checkout): open Spaces of non-cancelled Stays inside a destination whose guest sent a chat message in the last 48 hours, or who opted in to tip emails with a verified address (decisions.md waives the 48-hour rule for them).
- The key is `space:<id>:daily_tip:<send date>`, without rule or record: the job id and ADR 0007's ledger key, so retries, re-runs and recomputed facts send one tip per Space per day. The facts travel in the job data.
- Channels: inbox always (when a Conversation exists); email only with `tips_email_opt_in_at`, a verified and unsuppressed address; never push.
- Unsubscribe: a derived HMAC token (`GUEST_LINK_SECRET`, shared by jobs and chat-backend) in a guest page link `/unsubscribe-tips` that unsubscribes on open, plus `List-Unsubscribe` and `List-Unsubscribe-Post` headers pointing at `POST /api/email/tips/unsubscribe`. That one route is exempt from the Origin check by route config; it only ever turns tips off.
- Tip searches pass `record: false`, so a cron recomputing them does not count catalog recommendations.

## Consequences

- The admin must tick rainy-day places and event interests, or the rain and event rules never fire.
- A rainy week may tip the same place again; only places already in the plan are skipped.
- Opening the app without chatting does not count as use; a guest who only reads the Guide gets no inbox tip.
- `GUEST_LINK_SECRET` must be the same in jobs and chat-backend; both refuse the dev default in production.
- A tip names the record as it was at pick time, even if it is unpublished seconds later (as with safety alerts).
