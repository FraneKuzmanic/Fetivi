# 0006: Host replies reach the model as a note

**Status:** accepted, 2026-10-22 (ticket 23)

## Context

A Host's reply to a Host message must appear in the guest's Chat (with the Chat badge) and Fetivi must know about it, so it can answer follow-up questions. The reply arrives at any time, independent of the guest's turns: the guest may be away, or may have a confirmation card open.

The obvious shape is to store the reply as an assistant message in the Conversation. That breaks three things:

- An assistant-role message reads to the model as Fetivi's own words, not the Host's.
- Anthropic accepts a mid-conversation system message only right after a user message, so a reply that arrives between turns cannot go in as a system message either.
- The chat finds "the last assistant message" to continue a paused tool call. A reply landing while a card is open would become that message, and the guest's tap would continue the wrong one.

## Decision

- A Host reply is stored as one `messages` row with `kind = 'inbox'` and a `data-inbox` part. The guest's chat history shows it; the Chat badge counts inbox rows after `conversations.inbox_seen_at`.
- Inbox rows never enter model history. The turn loop builds the model's messages from `kind = 'chat'` rows only, so a paused call still resumes on its own message.
- On the guest's next message, the turn adds a system note right after it with the text of every inbox row since the guest's previous message ("The host replied to the guest's message …"). The next turn after that does not repeat it.
- The guest app keeps inbox rows out of the chat state too and shows them after the chat message they followed.

Ticket 23 also reads PRD §6.5 "never twice in one conversation" as at most one sent Host message per Conversation, enforced by a unique `handoff_messages.space_id` (one Conversation per Space). A declined draft does not count; the server can only verify what was sent.

## Consequences

- The model learns of a reply only when the guest writes again. A guest who reads the reply and says nothing needs no answer from Fetivi, so nothing is lost.
- Later inbox kinds (guest notifications, ticket 25) reuse the same rows and badge without touching model history.
- One Host message per Stay may feel strict in a long Stay; relaxing it is a change of the unique key.
