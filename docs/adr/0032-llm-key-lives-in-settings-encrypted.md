# 0032: The Anthropic key lives encrypted in the settings and wins over the environment

**Status:** accepted, 2026-11-17 (ticket 68); amended by ADR 0033: the key may be any provider's and comes with one model for every task.

## Context

The chat backend, the back-office API and the jobs process each read `ANTHROPIC_API_KEY` once at start-up and passed it to every model caller: chat turns, block and handoff translation, catalog drafting, house manual import and block retitling. Changing the key meant editing `common.env` and redeploying. The thesis supervisor asked that the admin can enter or change the key in the back-office settings.

## Decision

- **Stored on the settings row, encrypted.** The one-row `platform_settings` table gains the key as AES-256-GCM ciphertext under `sha256(LLM_KEY_SECRET)`, its last four characters in clear, and who changed it and when. `LLM_KEY_SECRET` is a new env secret in `common.env`, so the three processes share it; in production they refuse to start on its dev default.
- **Settings over environment.** A key saved in Settings wins; `ANTHROPIC_API_KEY` stays as the fallback. With neither, every caller keeps its not-configured behaviour (chat 503, `not-configured` results, the retitle CLI exits 1).
- **Read per call, cached 30 s.** Every model caller asks a per-process key source on each call. The source caches the answer for 30 s, so a change reaches the chat backend and jobs within that time without a restart. The back-office API drops its cache on every change, so its own Test sees the new key at once.
- **The admin sees the source, not the key.** Settings shows where the key comes from (Settings, environment, none), its last four characters, and who changed it and when. The API never returns the key or the ciphertext.
- **Test with the models list.** "Test the key" calls Anthropic's models list once, which bills no tokens.

## Rejected

- Plaintext in the database: database dumps and the WAL-G backups would carry the key.
- Environment only: the supervisor's request.
- Postgres `pgcrypto`: the key would travel in SQL text and could land in query logs.
- `LISTEN/NOTIFY` to push a change: more moving parts than a 30 s delay needs.

## Consequences

- Rotating `LLM_KEY_SECRET` makes the saved key unreadable. The processes log a warning and fall back to `ANTHROPIC_API_KEY`, Settings shows that fallback (or no key) as the source, and the admin enters the key again.
- The "environment" status shows the back-office process's `ANTHROPIC_API_KEY`. In production all three read the same `common.env`; in local development differing per-app `.env` files can disagree.
- There is no audit table for the key: only the last change is kept, on the settings row.
