# Fetivi: Spike results

**Date:** 2026-10-16 · Spikes S1 to S6 from `docs/fetivi.architecture.md` section 6. The spike code was throwaway and has been deleted; this file is the record of what was proved and what the build must carry over.

| Spike | Question | Verdict |
|---|---|---|
| S1 | Can an MCP elicitation confirm an Order in a browser chat? | Yes. V1 confirms by elicitation; AI SDK stays the loop |
| S2 | Does the Order and payment state machine stay consistent against Stripe? | Yes, with a mandatory reconciliation job |
| S3 | Do Ferryhopper's MCP App widgets render in our own React host? | Yes. MCP Apps kept for external UI |
| S4 | Does the whole unit record fit a cached system prompt? | Yes (7k tokens, 20/20 cache hits), with a different prompt layout |
| S5 | Does the Anthropic connector reach our servers; does our client reach Ferryhopper? | Both pass |
| S6 | Does one structured-output call translate a block into seven languages with structure kept? | Yes, 70/70 |

Versions used: `@modelcontextprotocol/server` and `/client` 2.3.1, `@modelcontextprotocol/ext-apps` 2.0.3, `ai` 7.0.x, `@ai-sdk/anthropic` 4.0.x, pg-boss 12.38, stripe-node 23 on API `2026-09-30.endive`, model `claude-sonnet-5-5`.

## S1. Order confirmation through elicitation

Proved: the guest asked for a boat trip, a confirmation card rendered from the server's pending record, and after the tap the model continued the same message and the Order was created once. Decline and cancel release the pending record; a double tap, a re-sent request and concurrent retries all produce one Order; a tampered `requestState` or another space's token is rejected by the SDK; parameters the model re-sends are ignored.

How the pause works: the write tool is an AI SDK tool with no `execute`, so the model step stops on it. The backend calls the MCP first half (`allowInputRequired: true`, `autoFulfill: false`) and streams a typed `data-elicitation` part carrying the schema and the opaque `requestState`. The tap calls `addToolOutput`; the backend re-issues `tools/call` with `inputResponses` and the byte-exact `requestState`, then resumes `streamText`. The backend holds no state between requests. `createRequestStateCodec` (HMAC, TTL, bound to the space) does the sealing.

Carry into the build: when the model calls read and write tools in one step, only the write tools pause.

## S2. Order and payment state machine

Proved:
- 150 random interleavings with fast-check (5,183 steps, 1,596 injected crashes, 371 duplicate webhooks) kept every invariant: capture only for the proposal confirmed at that instant; one OrderEvent per status change; terminal Orders hold no money; Fetivi's attempt state equals Stripe's; seats conserved; every required notification sent exactly once.
- Seven deliberate bugs (capture before confirm, no webhook dedupe, late checkout not voided, void ignoring a won capture, notify without idempotency, stale timer acting, `expires_at` recomputed) were each caught.
- Live Stripe test mode, direct charge on a Croatian Standard account: pay, confirm, capture with application fee, refund with fee; price change with a new session under a new key; Provider decline; nobody pays; payment after our hold expired (voided); dropped webhooks recovered by the expire job.

Without the reconciliation job the test fails: an authorization that lapses while a live Order is `confirming`, with the cancel webhook lost, leaves Fetivi and Stripe disagreeing. That path and a lost `checkout.session.completed` are closed only by reading Stripe.

Stripe facts:
- `payment_method_types` is rejected on the current API version; card-only uses `excluded_payment_method_types`. Klarna is on by default; Link cannot be excluded.
- `expires_at` must be 30 minutes to 24 hours ahead.
- Same idempotency key with different parameters is an error.
- Expiring a session that is no longer open errors, so the expire job then reads the session.
- The application fee is created at capture, so a voided authorization carries none.

Carry into the build: port the property test into `services` and run it at volume (the 500-run was not completed); the email provider must accept an idempotency key or notifications can duplicate.

## S3. Ferryhopper MCP Apps in our host

Proved: Ferryhopper's trip picker and disruptions widgets render through `AppBridge` (constructed with `client = null`, calls routed to the backend's MCP client and policy) inside a sandbox proxy on a separate origin with the server-declared CSP, with zero CSP violations and no horizontal scroll at 390 px. A widget-initiated `tools/call` passes through the policy (tested with a probe view; Ferryhopper's widgets only open links); a tool outside the pinned list is blocked; `open-link` outside `*.ferryhopper.com` is refused.

Carry into the build:
- Search "Stari Grad", not "Hvar": "Hvar" resolves to an all-ports group with zero sailings.
- `get_disruptions` returned nothing for Croatia over a week; do not treat it as a source of Croatian ferry alerts.
- A widget off screen reports its size only once scrolled into view; scroll new widgets in and use a placeholder height.
- Widgets are about 500 KB each; cache them by URI and pin hash.
- The deep link carries Ferryhopper's own affiliate id, not Fetivi's.

## S4. Whole unit record in a cached prompt

Measured on a realistic sample unit (a two-bedroom flat in Trogir with 12 blocks and 23 amenities, in English, not the real pilot unit):

| Item | Tokens |
|---|---|
| Projection, arrival details released | 7,026 |
| Instructions | 1,188 |
| 18 tool definitions | 3,850 |
| Cached prefix | 11,995 |

The cache read on 20 of 20 consecutive turns. Cost per turn on Sonnet 5.5 was $0.012 cached against $0.034 uncached. No private field or unreleased code reached the projection.

Found: Sonnet 5.5 binds thinking blocks to the whole top-level `system`, so changing anything in it mid-conversation fails with a 400. The situation (time, weather, About me) is sent as appended `role: "system"` messages instead (architecture 4.3).

Carry into the build: headroom under 8k is only about 12%, and translated projections (likely larger) were not measured. Re-measure with the real unit.

## S5. Protocol-era compatibility

Proved: the Anthropic MCP connector (`mcp-client-2025-11-20`) speaks 2026-07-28 natively (no `initialize`; `server/discover`, `tools/list`, `tools/call`) and calls read tools, even on a server set to `legacy: 'reject'`. It declares no client capabilities, so elicitation tools fail with a clean tool error (`-32021`) and V2 records them as unsupported. The official client in `auto` mode falls back to Ferryhopper's 2025-11-25 and lists and calls tools.

Carry into the build:
- `createMcpFastifyApp` rejects unknown `Host` headers; behind Caddy pass `allowedHosts: ['mcp.<domain>']`.
- A write tool called by a client without elicitation should return a tool error before storing a pending record.

## S6. Translation with structure preserved

Proved: one Sonnet 5.5 call per block with a seven-field JSON schema, on ten blocks (nine English, one Croatian), matched the source in 70 of 70 outputs on heading levels, list items, step numbers, link URLs and `{{placeholders}}`, with no placeholder damaged and the source language returned unchanged. Cost $0.07 per block on average; latency median 42 s, max 86 s.

Carry into the build:
- The prompt must fix formal or informal address per language (Hungarian switched between blocks).
- Italian uses the exonym "Spalato" for Split.
- A native speaker's read of the Croatian, German and Italian output is still pending.
