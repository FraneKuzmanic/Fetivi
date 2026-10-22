# 0008: Host notifications claim the message

**Status:** accepted, 2026-10-22 (ticket 24)

## Context

A Host message must reach the host by email (and by push on a phone where they turned alerts on), either at once or bundled in a Digest at the host's chosen times. Urgent messages bypass the Digest. Two paths can therefore notify the same message: the immediate `host-notify` job and a Digest slot. A host may switch mode between the guest's send and the job, a Digest job may be retried, and two cron runs may overlap.

A per-host "last digest" timestamp would miss a message whose insert commits after the timestamp moved, and could not tell an urgent message already notified from one still waiting.

## Decision

- `handoff_messages.host_notification_key` is set once, by whichever path notifies the message: `handoff:<id>:host` (immediate) or `host:<hostId>:digest:<slot>`. Both paths set it only where it is null (or already equal, for a retry), so each message is notified once, by one path.
- `completeHostMessage` always enqueues a `host-notify` job in its transaction. The job decides at run time, from the urgency and the host's current settings: urgent or Immediate → notify now; normal in Digest mode → defer to the Digest.
- A Digest claims its members in one transaction and never adds members on a retry, so a retried email has the same body for the same idempotency key. It is sent once per host per slot.
- The slot is the latest digest time at or before now, read in the timezone of the host's oldest property. A cron scan runs every 5 minutes; the job id comes from the host and the slot, so overlapping or caught-up runs enqueue one job.
- Each channel sends once through `host_notification_deliveries` (key, channel), as for guests (ADR 0007).
- Emails carry no guest text, no booker name and no PIN: unit, property, Stay dates, reason and urgency, a link to the Inbox, and a line that email replies do not reach the guest.

## Consequences

- An urgent message is never repeated in a Digest, and a Digest never repeats a message.
- Switching from Digest to Immediate does not flush messages already waiting; they stay in the Inbox with the unread badge. A Digest job already enqueued still sends its slot.
- A Digest is at most 5 minutes late.
