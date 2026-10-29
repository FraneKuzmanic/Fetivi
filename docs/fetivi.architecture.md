# Fetivi: Architecture

**Status:** ratified by Frane on 2026-10-15 (stack, shared core, PRD corrections); evaluation design deferred to its own phase; spikes S1 to S6 resolved 2026-10-16 (`docs/spikes.md`) · **Date:** 2026-10-16 · **Owner:** Frane Kuzmanić
**Intent:** `docs/fetivi.prd.md` (the PRD). This document decides *how*; the PRD decides *what* and *why*.

Sources, in order of authority: `master-thesis.md`, PRD section 11 (binding decisions, honoured here and not re-opened), the planning decisions log (re-validation of 2026-10-15 wins conflicts), `GLOSSARY.md` (terms used exactly), and the research files under `.scratch/research/` as evidence. Where this document diverges from a research recommendation, it says so and why.

This is a decision document, not an implementation plan. Per-ticket plans come later and may refine anything below that is marked reversible.

---

## 1. Problem and goals

Guests in a small Dalmatian rental should get answers about their unit and their destination and arrange local services inside one natural-language conversation, while the thesis measures what connecting the assistant to those services through MCP costs and enables compared with direct function calling. Every decision below is judged against three things: the guest completes an Order safely (never charged for an unconfirmed Order, never able to reach another Stay's data), the examiner can see MCP doing real work (elicitation, per-guest tokens, an external server consumed with no integration code), and one developer can build and operate the whole system alone.

## 2. Approaches considered

The PRD fixes the MCP topology (own host, four first-party servers, Ferryhopper). What remained open is how the rest of the system is shaped around it. Three shapes were weighed.

### A. One TypeScript monorepo, shared domain core, MCP servers as a separate process (recommended)

The domain logic (Orders, Offers, Stays, catalog, translations) lives in one package. Three processes use it: the chat backend (the MCP host and the guest API), the back-office API, and the MCP server process that mounts the four first-party servers. The chat backend reaches the domain only through MCP in V1; in V0 it calls the MCP servers' tool specs in its own process, which call the package (ADR 0002).

- For: one language for one developer; the official MCP client that handles elicitation is TypeScript, and the MCP Apps host bridge is TypeScript and React, so the host is TypeScript regardless; V0 versus V1 differ by exactly one thing, the MCP hop, which is what the thesis wants to measure; the servers are a real network service that the V2 connector and other hosts can reach.
- Against: the shared package means the MCP servers and the back office deploy together when the domain changes; the thesis must explain that the "web services" exposed through MCP are the MCP servers themselves rather than a REST layer underneath them.

### B. REST services first, MCP servers as thin wrappers over REST

What `mcp.md` section 6 recommended: build REST services with an OpenAPI description, hand-write MCP tools over them, and generate a second MCP server from the OpenAPI file as an evaluation variant.

- For: a conventional layering; the back office needs an HTTP API anyway; the generated-server variant is a cheap extra comparison.
- Against: every V1 tool call becomes two hops (host to MCP server to REST), so the measured "MCP overhead" includes an HTTP hop that MCP did not cause; two API surfaces to keep in sync; the back office does not need a public REST API, a server-rendered or RPC-style internal API is enough.
- Verdict: rejected as the core. The generated-server comparison is kept as an optional evaluation variant that can be produced from the domain package's schemas later.

### C. Python servers (FastMCP 4) with a TypeScript front end

- For: FastMCP's dependency injection makes token-derived parameters invisible to the tool schema, a neat fit for per-guest scoping; the Python `mcp` 2.3.0 package supports MRTR.
- Against: two languages and two type systems for one person; the domain logic would be in Python while the host, the eleven components and the MCP Apps bridge are TypeScript; the per-guest scoping pattern is a few lines in the TypeScript server too.
- Verdict: rejected.

**Recommendation: A**, ratified. The rest of this document assumes it.

## 3. Recommended approach

```
Guest browser (React PWA)           Host / admin browser (React)
      │  SSE stream, JSON              │
      ▼                                ▼
┌──────────────────────┐      ┌─────────────────────┐
│ chat backend (host)  │      │ back-office API     │
│ model loop, MCP      │      │ wizard, Stays, PINs,│
│ clients, token mint, │      │ inbox, catalog,     │
│ component rendering  │      │ curation, Providers │
└───────┬──────────────┘      └──────────┬──────────┘
        │ Streamable HTTP, Bearer <per-server JWT>
        ▼                                │
┌──────────────────────┐                 │
│ MCP server process   │                 │
│ /stay /local         │                 │
│ /services /trip      │                 │
└───────┬──────────────┘                 │
        │            shared domain package│
        ▼                                ▼
   PostgreSQL + PostGIS   ◄──  job runner (pg-boss): calendars, windows,
                                translations, drafting, digests, retention
External: Anthropic API · Ferryhopper MCP · Stripe Connect · DHMZ · MET Norway ·
          Jadrolinija RSS (with permission) · email · WhatsApp Business (open) · web push
Separate origin: sandbox proxy for MCP Apps (Ferryhopper widgets)
```

- The **chat backend** is the MCP host. Per turn it mints one short-lived token per server, calls `tools/list` once per situation (cached, deterministic order), hands the tool definitions to the model through ordinary tool calling, executes the model's calls through the official MCP client, and streams the resulting structured content to the browser as typed parts that the eleven components render.
- The **MCP server process** mounts the four first-party servers on one deployment at four paths. Each validates its own audience, derives Stay, unit, destination and space from the token, and never accepts those as arguments.
- The **back-office API** serves hosts and admins directly from the domain package. It is not an MCP client.
- The **job runner** does everything time-driven: calendar polling, Provider response windows, checkout hold expiry, digests, translation on save, catalog drafting and refresh, daily suggestions, retention deletes.
- The **evaluation harness** drives scripted guest scenarios against V0 (chat backend calling the same tool specs in-process, ADR 0002), V1 (through MCP) and V2 (the same servers through Anthropic's MCP connector), on one seeded database, and records per-turn measurements.

## 4. Key decisions

Each decision names the alternatives considered. "Reversible" means it can change during implementation without rework elsewhere.

### 4.1 Stack and libraries

| Layer | Decision | Why | Alternatives considered |
|---|---|---|---|
| Language and runtime | TypeScript end to end, Node.js LTS, pnpm workspaces monorepo | The MCP client that carries elicitation and the MCP Apps bridge are TypeScript; one language for one developer | Python servers (approach C) |
| MCP | `@modelcontextprotocol/server` and `@modelcontextprotocol/client` v2 (2.3.x), Streamable HTTP, `versionNegotiation: { mode: 'auto' }` on the client, legacy `initialize` shim left on in the servers | The only client that fulfils `input_required` round trips; `auto` is needed to speak 2026-07-28 at all and to fall back to Ferryhopper's 2025-11-25 server; the legacy path keeps 2025-era clients working (the Anthropic connector itself speaks 2026-07-28); behind Caddy the servers need `allowedHosts` set to the `mcp.` origin | `@ai-sdk/mcp` (throws on `input_required`, cannot carry Order confirmation); LangChain and Mastra adapters (carry MRTR but add a framework the thesis does not need) |
| Model loop | Vercel AI SDK core (`ai`) with `@ai-sdk/anthropic`; MCP tools converted to AI SDK tools by hand from the official client, not through `@ai-sdk/mcp` | Its provider abstraction is what makes "swap the LLM vendor" a measurable, small change; its typed message parts and human-in-the-loop tool state are the natural carrier for an elicitation that must pause across HTTP requests while the guest taps a card | Anthropic SDK directly with a hand-written loop (simplest, but the vendor swap would then need its own abstraction, which skews the integration-effort metric); OpenAI Agents SDK (no elicitation handler) |
| Model | Claude Sonnet 5.5 (`claude-sonnet-5-5`) for the guest conversation with adaptive thinking at low effort for chat; Claude Sonnet 5.5 for translation on save and host-message translation; Claude Haiku 5.5 for the catalog drafting job's extraction steps and the house manual import's single extraction call (the host reviews every draft) | All Claude API calls are paid from the $100 USD monthly API credit included in Frane's Claude Max 5x plan, so Sonnet 5.5 is the default for the guest conversation instead of Opus 5.5; translation into Croatian, Hungarian and Polish is quality-sensitive but low volume; drafting is bulk extraction with human review after it | Opus 5.5 for the guest loop |
| Second vendor for the swap experiment | OpenAI through the AI SDK's provider | A second provider the AI SDK already supports makes the swap a dependency change plus a prompt check, which is the point of the measurement | Gemini (its remote MCP story is in flux, irrelevant here since the host owns the MCP clients) |
| Guest app | React with Vite as a single-page PWA; `@ai-sdk/react` for the stream; i18next for the seven interface languages; MapLibre GL with an OpenStreetMap-based tile provider; web-push with VAPID | No SEO or SSR need; a PWA is required for Android push; MapLibre avoids Google Maps terms | Next.js (adds a server-rendering model the app does not need and sits awkwardly with a long-running MCP host process) |
| Back office | React with Vite, same component library as the guest app where it overlaps, mobile-first for host screens | Reuse of the eleven components in the Guide and My trip tabs is a PRD decision; the back office reuses the same card primitives | A server-rendered admin framework (would split the component code) |
| Chat backend and back-office API | Fastify, with `@modelcontextprotocol/fastify` for the MCP server process | Fast, typed, one HTTP framework across processes; the official adapter exists | Hono (equally fine; reversible), Express |
| Database | PostgreSQL 16 with PostGIS and pg_trgm; Drizzle ORM and its migrations; search embeddings in `real[]` columns, cosine in TypeScript (61) | Distance filters are the catalog's most common query; trigram search covers Croatian, which has no built-in full-text stemmer; Drizzle keeps SQL visible and types strict; a destination's catalog is small enough to score in memory after the SQL filters | Prisma (heavier runtime, weaker raw-SQL ergonomics for PostGIS); pgvector (only past a few thousand records per destination) |
| Semantic search | Voyage AI `voyage-4` embeddings via egress, with word matching as the fallback (61) | Multilingual (all seven guest languages), cheap; matches "seafood" to "grilled fish" where word matching cannot | pgvector with a local model (heavier operations) |
| Jobs and scheduling | pg-boss (Postgres-backed queue with cron and delayed jobs) | Every timer in the product (windows, holds, polls, digests, retention) lives in the database already; no Redis to operate | BullMQ with Redis (one more service); in-process `setTimeout` (lost on restart, which Order expiry cannot tolerate) |
| Payments | Stripe Connect, direct charges with `application_fee_amount`, Checkout Sessions with manual capture and a 30-minute `expires_at`, webhooks as the source of payment truth | Bound by PRD section 11 | Adyen, Mollie (Mollie cannot onboard private individuals, which rules out OPGs and hosts) |
| Email | A transactional email API with webhooks for bounces (Resend or Postmark; reversible) | Email is the source of truth for Orders and recovery, so delivery status matters | SMTP from the VPS (deliverability risk) |
| Provider WhatsApp links | WhatsApp Business Cloud API, behind the same notification interface as email | PRD requires email and WhatsApp for Provider links; verification and cost are an open PRD question, so the interface must work with email alone | None (email only) if verification fails |
| Web fallback search | Brave Search API with the allowlist applied as `site:` operators and re-checked on the returned URLs | Cheap, domain-filterable, no model call inside a tool | The Claude web search server tool called from inside the `local` server (an LLM call inside a tool, harder to attribute and meter) |
| Hosting | One Linux VPS (Hetzner class) running Docker Compose: Caddy for TLS and routing and serving both SPAs, the Node processes (chat backend, back-office API, MCP servers, sandbox proxy), the job runner, Postgres with continuous WAL archiving off-site (ADR 0023); `deploy/` | Public reachability is required for the V2 connector and for Stripe webhooks; one box is operable by one person; the pilot is one unit | Fly.io or Railway (fine, reversible); managed Postgres such as Neon (reversible; take it if backups become a burden) |
| Origins | `app.` (guest SPA and its API, served by the chat backend), `host.` (back-office SPA and its API, served by the back-office process), `mcp.` (MCP servers), `sandbox.` (MCP Apps proxy) | The MCP Apps spec requires the sandbox proxy on a different origin from the host page; each SPA calls an API on its own origin so the guest space cookie and the host session cookie never share a cookie jar (a shared `api.` origin would not isolate them) | One origin with paths (violates the MCP Apps rule); one shared `api.` origin (cookie isolation by name only) |
| Time | Every property carries an IANA timezone (Europe/Zagreb for the pilot); release times, end of checkout day, Provider response windows and reminders are computed in it; timestamps are stored in UTC | "End of checkout day" is a civil-day boundary, not the accommodation's checkout time, and must not drift with the server clock | Server-local time (wrong under daylight saving and on a foreign-hosted server) |
| Observability | OpenTelemetry in all three processes, trace context carried in MCP `_meta` per the spec, exported to a local Jaeger; per-turn metric rows (tokens, latency per hop, tool calls) written to Postgres for the thesis tables | The thesis needs the MCP hop isolated per turn; traces show it, rows make the tables | Logs only (cannot separate the hop) |
| Testing | Vitest; integration tests against a real Postgres in Docker; MCP Inspector CLI for conformance in CI; the evaluation harness as a separate package | Protocol conformance is a thesis metric | |

### 4.2 Data model (shape, not columns)

**Tenancy and access**

- `Host` has many `Property`; `Property` has many `Unit`. Property-level content is inherited by units and may be overridden per unit.
- `Unit` carries the permanent QR link slug, the structured core fields, amenities and `InfoBlock`s. Secrets (Wi-Fi password, codes, phones) are typed fields on the unit, never inside block text.
- `InfoBlock` has a category (one of the seven Guide sections), rich text in the host's source language, media, a visibility rule derived from its section (ADR 0025), and one `Translation` per guest language produced on save. Media: ADR 0003. Host picks, neighbourhood tips and the host's own Offers hang off the property.
- `Stay` belongs to a unit: check-in, checkout, party size, optional booker name and reservation number, the six-digit PIN (stored as entered so the host can re-read it; brute-force limits are the defence), the arrival-details release time, a "possibly cancelled" flag, and links to the `CalendarEvent`s that proposed it.
- `Space` is one device's private world inside a Stay: an opaque long-lived cookie token, language, optional email with opt-in flags, About me preferences (with a special-category marker set only by the guest's own tap), the recovery token, and a `closed_at` derived from checkout. Conversations, plans and Orders belong to a space.

**Conversation and trip**

- `Conversation` holds `Message`s with typed parts (text, tool call, tool result, component payload, elicitation, inbox item). Inbox items are messages of a distinct kind so the chat thread and the badge come from one table.
- `PlanItem` is one entry of one Stay day: a booked Order or a suggestion.
- `Feedback` stores thumbs and the one-tap reason per assistant message as counts and topics, never text.

**Destination and catalog**

- `Destination` is a centre and a radius. `Place`, `Event`, `TransportNote` and `DayTrip` belong to it, each with `verified_at`, season rows and opening-hours rows with validity dates, a source URL per drafted field, and a category with a staleness budget.
- Open-data-derived fields live in a separate `PlaceOpenDataSource` table keyed by place and source (OSM, bathing-water list, Overture or Foursquare) so share-alike content is never mixed into curated columns. Place images carry licence and attribution.
- `CurationItem` is one queue with a kind (draft, refresh diff, guest-flagged, host place suggestion, host Provider suggestion, fallback topic cluster) and `FallbackLog` records every web fallback.

**Services and Orders**

- `Provider` is admin-owned: deal terms, contact channels, Stripe connected account, tax number for the platform disclosure duty.
- `Offer` belongs to a Provider or to a host (own service): Category, Order kind, availability mode (live, allotment, on request), payment mode (direct or online), cancellation policy text, response window, which guest contact fields the Provider receives, and for live mode the adapter kind and external product reference. `AllotmentSlot` rows hold schedule and capacity for allotment Offers.
- `Order` has the two independent status fields from the glossary (Order status, Payment status), the order handle (the Order's own id, which the `services` server is idempotent on), the Stay date, quantity, the guest contact fields given on the card, the Provider's external reference, the per-order Provider link token (hashed), a snapshot of the cancellation policy and financial terms as approved, and the id of its current proposal. `OrderEvent` is the append-only audit trail of every transition with its cause (guest tap, webhook, Provider tap, timer, admin).
- `OrderProposal` is one versioned set of terms for an Order: date and time, quantity, price and currency, who proposed it (the Offer's listed terms, a Provider's "Suggest another time" or "Accept with price") and its card expiry. The Order handle stays stable; each new proposal supersedes the previous one, whose confirmation card stops working. Confirmation, timers and payment operations bind to a proposal, never to the Order alone.
- `PaymentAttempt` is one Stripe Checkout Session and payment intent for one proposal: hold expiry, authorization, capture, cancellation or refund state, and the Stripe event ids already processed. A changed price means a new attempt, never a mutated one.
- `InventoryHold` is temporarily held capacity for one proposal (an allotment slot decrement or a live engine's hold reference) with its own expiry; it is committed when the Order is confirmed and released on decline, expiry or failure.
- A minimal `OrderLedger` projection (Offer, date, quantity, price, statuses, Provider, email) is what survives the 30-day deletion for the 11-year commission accounting rule; the rest of the Order's personal data is deleted with the space.

**Host communication**

- `HandoffMessage` carries the guest's sent text, its translation, urgency, read state and the host's reply with its translation. `Suggestion` is a topic-level content gap for a host, with the count of distinct Stays behind it.
- `CalendarFeed` per unit with its last poll; `CalendarEvent` by feed UID with merge and dismissal state.

### 4.3 Boundaries and contracts

**Guest identity and per-server tokens.** The QR link identifies the unit. A correct PIN creates a space and sets an httpOnly cookie carrying an opaque space token. On each turn the chat backend resolves the space, decides the situation (before arrival, in stay, after checkout, inside or outside a destination, host has own Offers) and mints one JWT per first-party server: `aud` the server's canonical URL, `sub` the space id, claims for Stay, unit, property and destination, a scope list, five-minute expiry, signed with a key the servers verify through a JWKS endpoint on the chat backend. Each server publishes RFC 9728 protected-resource metadata, rejects any token not issued for it, and answers 401 or 403 with `WWW-Authenticate`. Tool schemas carry no guest, unit, Stay or space identifiers. Any id the model does pass (Offer, Place, Order handle, plan item) is re-checked against the token's claims in the tool. The guest token is never forwarded anywhere; servers call Stripe, Provider systems and open-data sources with their own credentials. The thesis states plainly that issuing guest-scoped tokens from a first-party backend is application-specific and not prescribed by the MCP authorization spec.

**Authorization matrix.** Scopes are granted per action and per situation; a tool checks the scope on the first half of a call and again when a pending action is completed, because the situation can change in between (checkout day ends while a card is open). "After checkout" begins at the end of checkout day in the property's timezone.

| Action | Before arrival | In stay | After checkout, 30 days | Outside a destination |
|---|---|---|---|---|
| `stay` read unit (arrival details gated by release time) | yes | yes | yes | yes |
| `stay` draft and send host message | yes | yes | no | yes |
| `local` reads, `web_fallback_search` | yes | yes | yes | fallback only, no catalog |
| `services` list Offers, check availability, list my Orders | yes | yes | list only | host's own Offers only |
| `services` create Order | yes, dated within the Stay | yes | no | host's own Offers only |
| `services` cancel, respond to a new time or price | yes | yes | yes, unresolved Orders only (`orders:manage`) | yes for own-Offer Orders |
| `trip` read plan and About me | yes | yes | yes | yes |
| `trip` update plan, update ordinary preferences | yes | yes | no | yes |
| Special-category preference storage | never through a tool | never through a tool | no | never through a tool |

Special-category data is stored only by the guest app's own tap flow, which calls the backend directly with the guest's action as the credential; `update_about_me` rejects special-category fields regardless of any flag the model supplies, and the model may use an inferred sensitive fact in the current conversation only. After checkout the chat is closed by the backend; My trip calls the permitted tools directly without a model.

**Approved-action binding.** Every write tool (`create_order`, `cancel_order`, `respond_to_order_update`, `send_host_message`) runs in two halves inside one call. The first half validates, stores a pending record bound to the space with a short expiry, and returns `input_required` with a form-mode elicitation whose `requestState` is HMAC-signed and names the pending record. The host renders the confirmation card from the pending record's stored fields, never from model text. The guest's tap re-issues the call with `inputResponses`; the server loads the pending record by id from `requestState`, verifies the HMAC, the principal and the TTL, marks it consumed in the same transaction, and completes it. Parameters the model re-sends on the retry are ignored. Decline and cancel actions release the pending record. V0 uses the same pending record and the same completion rule, reached through the chat's answer request instead of elicitation.

**Idempotency with external systems.** The Order id is the idempotency root and the proposal id the version. Stripe calls use keys of the form `order:<id>:proposal:<n>:<operation>` (create session, capture, cancel, refund), so a changed price is a new key on a new attempt rather than a rejected reuse. The attempt stores the session's `expires_at` before the create call and the key includes it, so a retry sends byte-identical parameters (Stripe rejects a reused key with different ones); `client_reference_id` is the attempt id, so a webhook finds its attempt before the session id is written back. Provider systems receive the Order id as the external reference and are queried by it when a confirmation is lost. Webhooks are processed once per Stripe event id, recorded on the attempt. Timer jobs are keyed by Order id, proposal id and operation so pg-boss deduplicates them.

**Order and payment state machine.** One module owns all transitions and is the only writer of the two status columns (in code, `orders/machine.ts` with its payment half in `orders/payments.ts`; both write through the machine's one `writeChange`). Each transition commits three things in one database transaction: the status change, its `OrderEvent`, and the next required job (capture, void, notify, lookup, expire) inserted into pg-boss through the same transaction, so a crash between "confirmed" and "capture scheduled" cannot happen. External calls run outside the transaction, in the job, and their outcome is written back durably; a job whose response is lost re-reads the external state by the idempotency key or by Order reference before acting. The capture job re-checks that the Order is still `confirmed`; the void job treats an already-captured intent as captured and refunds it. A reconciliation job, required in the first version, periodically reads every open session, authorized intent and non-final `InventoryHold` from Stripe and the engine and feeds what it finds back through the machine as events; it is the only thing that closes a lost completion webhook and an authorization that lapses while a live Order is `confirming`. Triggers are explicit (guest confirmation, checkout completed webhook, adapter result, Provider link action, window timer, hold timer, admin override). Pay-online Orders authorize at checkout, confirm, then capture; decline, failure or expiry cancels the payment intent. A Provider's new price or time creates a new proposal and returns the Order to awaiting confirmation; the old attempt is voided and Provider link actions are bound to the proposal id, so a tap on a stale page is a no-op; authorization always precedes confirmation on the proposal being confirmed. A live engine that never answers leaves the Order in `confirming` until a lookup by reference resolves it or a deadline alerts the admin. Online payment is limited to card methods at first, because some methods that allow manual capture collect an instalment at authorization, which would break the "never charged for an unconfirmed Order" guarantee; it is enforced with `excluded_payment_method_types` and a check on the created session's methods (Link cannot be excluded and stays). Refund eligibility is computed from structured policy rules snapshotted on the Order (free until a cutoff before the start, then a percentage), with an admin override; policy text alone is shown to the guest, never used for calculation. Validated by spike S2.

**Provider adapters.** One interface inside `services`: check availability, hold (returns a hold reference and expiry), commit (turns a hold into a reservation under the Order id as reference), release, cancel, lookup by reference, and an inbound handler for engine cancellations. Three implementations: allotment (holds and commits decrement `AllotmentSlot` under a row lock, releases and cancellations restore it), on request (hold is a no-op, the per-order link is sent and the Order waits for the Provider tap or the window timer), live (one booking-engine client; Bókun first because the one Trogir boat operator with an API uses it, and its hold-then-checkout shape matches the contract; an engine without holds implements hold as reserve and release as cancel). The checkout hold and the inventory hold expire together at the attempt's stored `expires_at` (Stripe's minimum is 30 minutes); a checkout completed after the hold has expired is voided and the guest is told the Order expired. Whether Fetivi can obtain a Bókun marketplace contract is an external dependency, see open questions. Adapters are invisible to the model.

**Egress.** One outbound HTTP module with an allowlist is the only way any process fetches a URL: open-data sources, venue sites during drafting, the weather services, the Jadrolinija feed, the Brave Search API, Voyage AI, Stripe, Ferryhopper. Destination allowlisting bounds where data can go, not what goes. Catalog search sends the search words of `search_places`, `search_events` and `get_transport_notes` (the model's `query` and `avoid`) to Voyage AI to embed them; the jobs process sends published catalog and host-added place text (`docs/privacy/search-text.md`). These search words are model-shaped free text (up to 200 characters, no payload check): they may restate a guest preference, such as a diet, but no identifier or Stay field is ever added to them. Beyond these, two tools send model-shaped text outward and each has its own payload contract: the host message (free text, only after the guest's tap) and `web_fallback_search`, whose query is a constrained argument (topic keywords and a place name, length-limited, rejected when it contains an email, phone, code, PIN or any About me value) rather than free text, with tests that injected content cannot move private data into the query. Ferryhopper and Stripe receive only structured fields. The PRD's sentence that the host message is "the only free-text outbound" needs this correction (see open questions).

**Untrusted content.** Ferryhopper tool results, Provider-authored Offer text, host-authored blocks and drafted catalog text are untrusted when they enter the model's context. Mitigations: tenancy derived from the token so injection cannot cross Stays; host-rendered confirmation for every write; no tool that sends arbitrary text to arbitrary recipients; length limits and markup stripping on admin and host input; Ferryhopper's tool list pinned at the host and its output labelled as Ferryhopper's in the system prompt.

**Prompt and caching.** Request order is tools, then system, then messages. The system prompt is a frozen instruction block plus the unit record's authorized guest projection (released arrival details only, no private host fields, stored translations in the guest's language) with a cache breakpoint after it; every request also carries Anthropic's automatic breakpoint (top-level `cache_control`), which caches the conversation history; The top-level system prompt is frozen for the conversation, because the model binds thinking blocks to it and any change fails the next turn; About me, the Stay dates, the date and time and the weather summary are appended as a mid-conversation `role: "system"` message when they change. The tool list comes from `tools/list` in the server's deterministic order and is cached per situation. The projection is rebuilt when arrival details are released and when the host edits the unit; open conversations receive the change as an appended system message, and the rebuilt projection is used from the next conversation. Spike S4 measured about 7k tokens and a cache hit on every turn.

**MCP Apps.** The guest app hosts Ferryhopper's widgets with `AppBridge` from `@modelcontextprotocol/ext-apps` 2.x, a hand-written host renderer (none is shipped), a sandbox proxy served from the `sandbox.` origin, the server-declared CSP applied, and tool calls initiated by the widget routed through the host's own MCP client and policy. First-party components are never MCP Apps.

**Back-office authentication.** Email and password with verification, argon2 hashing, server-side sessions in Postgres, roles host and admin, and a logged "act as host" that records the admin, the host and the time on every write. A maintained auth library (Better Auth or equivalent) may be used; reversible.

**Translation pipeline and publication.** Blocks are stored as Markdown with a source revision number that increments on every host edit of the title or text. On save a job for that revision sends the source block to Sonnet 5.5 with a structured-output schema for the seven languages, verifies that heading levels, list items, step numbers, link URLs and `{{placeholders}}` match the source, and stores one `Translation` per language tagged with the revision. A job result for a superseded revision is discarded; a host's manual correction is stored against the revision it corrects and is never overwritten by a retry. Guests see the last fully published revision until the new one has all seven languages, at which point publication invalidates the unit's cached guest projection once. "Translations done" as a go-live condition means the current revision is published. Secrets are never in the text. Catalog text uses the same job. Property and unit free-text fields use the same job; a field shows its source text until the translation of that exact text exists (ticket 50). Spike S6 confirmed structure preservation. The same call detects the source language.

**Retention and recovery.** Daily jobs delete conversations, preferences and space data 30 days after checkout, keep the `OrderLedger` projection for 11 years, and keep opted-in conversations for evaluation. Postgres runs with continuous WAL archiving to off-site storage for point-in-time recovery, not nightly dumps alone; restoration is rehearsed before real payments are taken, and the reconciliation job above is what closes the gap between restored records and Stripe's state.

### 4.4 Tool surface (shape)

About eighteen first-party tools, loaded up front, plus Ferryhopper's five pinned tools.

- `stay`: resource `unit` (the authorized projection; the time gate is applied by the server); tools `draft_host_message`, `send_host_message` (elicitation).
- `local`: `search_places`, `get_place`, `search_events`, `get_weather`, `get_transport_notes`, `web_fallback_search` (allowlisted; logs a `FallbackLog` row).
- `services`: `list_offers`, `check_availability`, `create_order` (elicitation), `cancel_order` (elicitation), `respond_to_order_update` (elicitation), `list_my_orders`.
- `trip`: `get_plan`, `update_plan`, `get_about_me`, `update_about_me`.
- Ferryhopper (external): `search_ferry_trips`, `trip_details`, `get_ports`, `get_direct_connections_for_ports`, `get_disruptions`.

Read tools carry `readOnlyHint: true`; write tools carry `destructiveHint` and `idempotentHint` honestly. All tools return `structuredContent` with an `outputSchema`, plus a text block for hosts without structured support.

### 4.5 Evaluation design (architecture part)

- The harness is a package that resets one database fixture per scenario, stubs external responses (Stripe test clocks, a recorded Ferryhopper, fixed weather), runs about forty scripted guest scenarios against V0, V1 and V2 with the same model, prompt and Offers, repeats each scenario several times, and reports cache state alongside tokens.
- Order scenarios are judged by business end state. Informational and recommendation scenarios carry expected facts, permitted sources, forbidden claims (an invented place, price or availability) and tool-use assertions (property facts must come from the unit projection, local facts from a `local` tool); a database end state cannot tell a correct Wi-Fi answer from an invented one.
- Attribution caveat: V0 and V1 share the domain package, the Provider adapters and the AI SDK's provider abstraction, so "add a Provider adapter" and "swap the LLM vendor" may cost the same in both. That is a valid result. The thesis must separate what the shared architecture gives from what MCP gives; the integration task that does differ is "add Ferryhopper", which V0 cannot do without writing an MCP client. The PRD's integration-effort metric should be re-framed accordingly (see open questions).
- Conformance: MCP Inspector for inspection and smoke tests; for the conformance claim, the official MCP conformance test suite if it covers 2026-07-28 at build time, with pinned requirements and reported exclusions (to verify).
- V0 is the chat backend with a flag that (`TOOL_TRANSPORT=inprocess`) binds the same tool specs to in-process calls (ADR 0002); confirmation goes through the pending-record handler behind the chat's answer request.
- V1 is the production path.
- V2 calls the Anthropic Messages API with the MCP connector (`mcp_servers` plus an `mcp_toolset`, beta header `mcp-client-2025-11-20`) pointing at the public `mcp.` origin with a per-scenario guest token as `authorization_token`; tasks needing elicitation are recorded as unsupported.
- Security scenarios (injected Offer text, Order without confirmation, replayed handles, wrong-audience tokens) run as part of the same harness.
- Per-turn rows record tokens in and out, cache reads, wall time, time inside MCP calls, number and names of tool calls.

### 4.6 Decisions deliberately not taken here

- Business and legal items in PRD section 9 (travel-agency registration, host service legal gates, OTA reservation data as a business, permissions to obtain).
- The build order is PRD 6.7 (thesis core first), accepted 2026-10-15; the architecture supports any order.
- Pilot thresholds and evaluation margins.

## 5. Missing pieces

Things the recommended approach depends on that do not exist yet or must be obtained.

- A guest-token issuer with JWKS and RFC 9728 metadata on each server (small, but the thesis describes it, so it must be clean).
- A host-side MCP Apps renderer; `ext-apps` ships the bridge and a reference host only.
- A conversion layer from official-client tool definitions to AI SDK tools that preserves `input_required` as a pausable tool state.
- The Order state machine module with its timers.
- A Bókun marketplace contract, or any other booking-engine access, for the live adapter. Without it, live mode is built against Bókun's sandbox and demonstrated with allotment and on-request Offers.
- Stripe platform approval for a travel-reservation profile (Stripe lists it as restricted; a manual review may follow).
- Brave Search API key; transactional email account; WhatsApp Business verification (optional).
- OpenTelemetry collector and Jaeger in the Compose stack for the thesis figures (one Jaeger v2 container, which is the collector; ADR 0022).
- Fixtures: a seeded Trogir destination, one real Provider per availability mode, the forty scenarios.

## 6. Spikes

Six spikes de-risked the one-way doors before the build; all resolved on 2026-10-16 in favour of the design as written, and the corrections they found are folded into sections 4.1 and 4.3. What each proved, the measurements, and the details the build must carry over are in `docs/spikes.md`.

- S1, Order confirmation through elicitation in a browser: works; V1 confirms by elicitation and the AI SDK stays the loop.
- S2, Order and payment state machine against Stripe test mode: invariants hold; the reconciliation job is mandatory.
- S3, Ferryhopper MCP App widgets in the custom host: render and round-trip; MCP Apps kept for external UI.
- S4, whole unit record in a cached prompt: about 7k tokens with a cache hit every turn; the record stays in the prompt.
- S5, protocol-era compatibility: the Anthropic connector and Ferryhopper both work with the v2 SDK.
- S6, translation with structure preserved: 70 of 70 outputs matched; one job per block.

Built with tests rather than spiked, because they are reversible: calendar sync edge cases (fixture feeds for merge, date change, vanished event), catalog seeding with licence separation (a schema decision already made above), the eleven components, the wizard, notifications.

## 7. Open questions

Architecture-level items deferred on purpose, with what settles each.

- **Integration-effort metric (PRD section 7).** The shared architecture makes some tasks equal in V0 and V1; re-frame the metric to measure what MCP adds (Ferryhopper with no client code, protocol confirmation, token scoping) and report equal-effort tasks as a finding. Settled with the evaluation design.
- **Hosting target.** Settled: Docker Compose on any Linux VPS (ticket 47). The provider is Frane's choice, recommended in `deploy/RUNBOOK.md`.
- **Email provider and WhatsApp.** Resend chosen in ticket 25 (idempotency keys; Svix-signed bounce webhooks). WhatsApp depends on Meta verification and cost (PRD section 9).
- **Live adapter access.** Bókun marketplace contract or another engine. Settled by Frane's outreach; the architecture does not depend on the answer.
- **Rich text format.** Markdown, confirmed by S6; the wizard ticket picks an editor that stores it.
- **Web fallback search provider.** Brave is proposed; settled when the `local` server is built.
- **ADRs.** The calls above that prove contentious (the shared-core shape, the AI SDK loop, Markdown blocks) should become entries under `docs/adr/` once ratified, per `docs/agents/domain.md`.

## 8. Review log

**2026-10-15, external review.** Eight findings and four smaller items. All accepted into sections 4.2, 4.3, 4.5 and 6: inventory holds with their own lifecycle and lookup by reference; transitions committing their next job in the same transaction plus a mandatory reconciliation job; versioned proposals and payment attempts under a stable Order handle; a payload contract per outbound tool instead of destination allowlisting alone; a full authorization matrix with a non-tool path for special-category data and re-checks on completion; scenario assertions beyond database end state, the attribution caveat and the conformance suite; translation revisions with a publication rule; spike fallbacks as proposals rather than automatic changes; card-only payments at first, snapshotted cancellation terms, property timezones, point-in-time recovery. Two findings also point at PRD wording (free-text outbound, integration-effort metric) and are listed as corrections for Frane in section 7 rather than changed silently. One item is held as unverified: whether the official MCP conformance suite covers 2026-07-28.
