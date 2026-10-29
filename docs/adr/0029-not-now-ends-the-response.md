# 0029: Not now on an order or host-message card ends the response without the model

**Status:** accepted, 2026-10-29 (ticket 66)

## Context

A guest's "Not now" on a confirm card resumed the paused tool call and ran the model again. In the chat test the model treated the decline as a failure: it said the order "hasn't gone through", offered to try again, and its text was glued onto the previous bubble. Every decline also cost a paid model turn.

## Decision

- **No model turn after a plain decline.** When the guest declines a `create_order` or `send_host_message` card and the tool returns its own decline outcome (`not_ordered`, `not_sent`), the loop stores the outcome and ends the response. The card collapses into a quiet "Not sent" line. The outcomes live in one shared map (`QUIET_DECLINES` in `@fetivi/ui/payloads`), read by the loop and by the guest app.
- **The model learns of it in the next turn.** The stored tool result is in the history the next turn resends, and the prompt and the `suggest_replies` description forbid suggesting again what the guest declined.
- **Anything else still goes to the model.** An order that won a race, an expired record or an error runs the model so it can explain. Cancel's "Keep it" and the respond card's "Not now" are unchanged.

## Rejected

- Collapsing the card in the browser only: the model would still run and answer.

## Consequences

- A card cancelled because the guest typed on is stored with the same decline outcome, so after a reload it also reads "Not sent".
- Adding another guest-confirmed tool with a quiet decline means one entry in `QUIET_DECLINES`.
