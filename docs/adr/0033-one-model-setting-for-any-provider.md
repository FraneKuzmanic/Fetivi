# 0033: One model setting for any provider's key

**Status:** accepted, 2026-11-19 (ticket 71). Amends ADR 0032.

## Context

ADR 0032 put the Anthropic key in the admin's settings. Every model caller was Anthropic-only: the chat through the AI SDK's Anthropic provider, and catalog drafting, block and handoff translation and house manual import through Anthropic's own SDK, each on its own Claude model. The thesis supervisor asked that the admin can use any well-known language model, not only Anthropic's.

## Decision

- **Any provider's key, recognised from the key.** The admin pastes a key from Anthropic, OpenAI, Google Gemini or Mistral. The prefix names the provider (`sk-ant-`, `sk-`, `AIza`); a key with none is tried against Mistral, which has no prefix. The key is checked with the provider's models list, which bills no tokens and fills the model picker with the models that write text.
- **One provider, key and model for every task.** The settings row keeps the provider and the model next to the encrypted key (ADR 0032 still holds for the key). The guest chat, catalog drafting, block and handoff translation, house manual import and block retitling all run on that one model.
- **Every caller goes through the AI SDK.** Each provider has its AI SDK package; structured output uses the SDK's object output, streamed. Anthropic's options (effort, adaptive thinking, prompt caching, native structured output) are sent under the `anthropic` key, which the other providers ignore.
- **The environment fallback keeps today's models.** With no key in Settings, `ANTHROPIC_API_KEY` is used and each task keeps its own default Claude model (Sonnet 5.5 for chat and translation, Haiku 5.5 for drafting and manual import). A key saved before ticket 71 is an Anthropic key with no model, so it behaves the same until the admin picks one.
- **The key is checked again on save.** The server checks the key and that the model is on the provider's list before storing them, so the stored provider and model are always the provider's. A saved key can change its model without being pasted again.
- **Usage counts tokens per model id.** A model missing from the price table is counted as unpriced, never given a guessed cost.
- **Embeddings stay on Voyage.** Catalog search is not part of the setting: another embedding model would mean embedding the whole catalog again.

## Rejected

- A model per task: more choices for the admin than the supervisor's request needed, and a cheap model on translation would undo spike S6.
- Keeping Anthropic's SDK for Anthropic and the AI SDK for the rest: two code paths in every caller.
- Asking the admin to choose the provider: the key already says it.

## Consequences

- Every model caller's egress allowlist holds the four providers' API hosts.
- Prompt caching, adaptive thinking and effort apply only on Anthropic; the measured cost and quality in the evaluation hold for the Claude models only.
- A provider whose models list does not mark text models (OpenAI) is filtered by model family, so a new family may need a code change before it shows in the picker.
