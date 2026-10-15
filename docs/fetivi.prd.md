# Fetivi: Product Requirements Document

**Status:** draft for architecture planning · **Date:** 2026-10-15 · **Owner:** Frane Kuzmanić
**Thesis:** Development of a Digital AI Assistant for Guests in Short-Term Accommodation Using the Model Context Protocol (MCP)

This document states *what* Fetivi is and *why* it is being built. It does not decide *how*. Engineering decisions (stack, data model, security boundaries, project structure) belong to the architecture plan, with the exceptions listed in section 11, which were settled during planning and bind the architecture.

Sources, in order of authority: `master-thesis.md` (thesis title and description; every requirement in it must be met), the planning decisions log (four grilling sessions plus one re-validation session, 2026-10-13 to 2026-10-15), `GLOSSARY.md` (domain terms, used exactly), and the original vision notes. Research files under `.scratch/research/` are evidence, not decisions.

---

## 1. Problem statement

**Guests** in short-term rentals spend their stay with unanswered questions and unrealised plans. They do not know the Wi-Fi password, the checkout time or how the washing machine works, and they hesitate to message the host a third time. They distrust generic travel sites and fear tourist traps, but the host's spoken tips are forgotten by the second day and rarely match the guests' own interests. Local services that would make the trip better (a boat trip, a transfer, a box of local produce, a dinner with locals) stay invisible because arranging them means finding, contacting and paying each small supplier separately, often across a language barrier. The cost of not solving this is a flatter trip, more friction with the host, and a weaker review for the accommodation.

**Hosts** of small Dalmatian rentals repeat the same information to every arriving party, answer the same basic questions by message in languages they do not all speak, and know only a fraction of what their area offers. They pay for guest communication with their own time. The cost of not solving this is hours per week during the season and reviews shaped by a destination experience the host cannot influence.

**The thesis problem** underneath both: tourism services today are reached through web portals that guests browse, search and book one by one. The thesis asks whether a large language model, connected to those services through the Model Context Protocol, can replace that with natural-language access that not only informs but *acts* (checks availability, reserves, orders), and what that costs in reliability, latency and integration effort.

Reframe test: the problem above admits more than one solution (a better guidebook, a chatbot that links out, a human concierge service). Fetivi's bet on an assistant that acts is stated in section 3, not here.

## 2. Evidence

| Claim | Status | Source |
|---|---|---|
| Hosts repeat the same information and answer repetitive messages; language barriers are common | **Observed first-hand.** Frane hosts a unit in Trogir listed on Booking.com and Airbnb. | Vision notes; pilot unit |
| No competitor's assistant completes a booking inside the conversation. STAY App states its concierge "does not perform actions such as bookings or requests"; Duve's AI sends a purchase link; Sunver and MyRent are answer-only; Enso Connect's autonomous actions are undocumented. | **Verified** on eleven products' public material. | `.scratch/research/competitors.md`, "Gaps none of them fill well" |
| Nobody combines who the guests are, their dates and bookable inventory into personalised recommendations; everything is a static host-curated list. | **Verified** on the same eleven. | same |
| Affordable guidebook products for small Croatian hosts have no notion of a stay; per-stay access exists only where the vendor is or integrates a PMS. | **Verified.** | same |
| Small local suppliers with live availability (boat tickets, transfers, produce) are covered by no one; supply is either a global affiliate feed or an undocumented regional set. | **Verified.** | same |
| Most local providers cannot be integrated by API: 3 of 17 checked Trogir and Split providers use a booking engine with an API. | **Verified** by checking the providers' booking pages. | `.scratch/research/mcp-clients-and-providers.md` |
| Booking.com and Airbnb APIs are not available to a new independent developer (Booking.com paused new providers; Airbnb is invitation only). | **Verified.** | `.scratch/research/guest-access-and-ota.md` |
| Booking.com's iCal export carries only a UID, dates and "CLOSED - Not available". | **Verified** on Frane's own export file. | decisions log, session 2 |
| Guests hesitate to ask the host repeatedly, forget spoken tips, distrust online recommendations, fear tourist traps | **Assumption.** Plausible and widely repeated, not measured. Validate via pilot: thumbs ratings, opted-in conversations, count of host messages per stay. | Vision notes |
| Guests will complete an Order in chat rather than book the same thing elsewhere | **Assumption.** This is the core product bet; see section 4. | |
| Hosts will accept one extra step per booking (registering the Stay and passing on a PIN) in return for stay-aware access | **Assumption**, accepted by Frane as the price of working without OTA APIs. Validate with the ten-host survey (section 9). | decisions log, session 1 |

## 3. Thesis: why build it

**Why this.** Every competitor stops at information. Their assistants answer from the host's content and then link out, or hand off to a human. The open ground, confirmed across eleven products, is an assistant that *acts*: checks a local provider's availability, reserves, takes payment and confirms, inside the conversation, for small suppliers who have no API. Fetivi is built on that ground. It also combines three things nobody combines: who the guests are (preferences and party), when they are there (Stay dates), and what is actually bookable, so a recommendation can end in "arrange it here" rather than a link.

**Why now.** Two things changed. First, LLMs can now run multi-step tool use reliably enough to execute transactions, and a standard protocol (MCP) exists for connecting them to services, with real tourism servers already published (Ferryhopper, Booking.com, Stripe). Second, the OTA data route is closed to independents, so the products small hosts can afford have given up on stay awareness. A design that is stay-aware without any OTA API (calendar files plus a host-issued PIN) is a gap no one fills.

**Why they switch.** Guests cope today with a paper folder or a static guidebook, the host's WhatsApp, Google Maps and ChatGPT. Fetivi beats that cope only if it knows things those cannot know (this unit, this party, this host's picks, curated and seasonal local data with a freshness date, which services are bookable) and does things they cannot do (book and pay in the same conversation, relay to the host in the host's language, warn about weather and ferry disruptions that touch the guest's plan). Hosts cope today with repeating themselves; Fetivi must demonstrably reduce messages per stay or it has no value to them. Providers cope today with phone calls; Fetivi must bring them Orders they would not otherwise get, with a one-tap response and no new software.

**Why the data is the moat, not the model.** If Fetivi relied on web search it would be ChatGPT with a QR code. Its answers about the property come only from host data; its answers about the destination come first from an admin-curated, seasonal, source-attributed catalog; web search is a logged fallback restricted to an allowlist. The admin's curation effort is the product's competitive advantage and is deliberately in scope.

**Why MCP, honestly.** Frane rejected "every provider runs an MCP server" as unrealistic. MCP's value here is a clean boundary between the assistant and heterogeneous services (provider differences become adapters behind one interface), reusability of Fetivi's servers by other assistants, consumption of at least one real external server with no integration code, and protocol features beyond plain function calling (confirmation elicitation, per-guest scoping, external UI). The thesis measures the costs as well as the benefits.

## 4. Hypotheses

Two bets, one for the product and one for the thesis. Each has a wrong condition.

### 4.1 Product hypothesis

> **We believe** giving guests a stay-aware assistant that answers from host and curated data and can complete Orders in the conversation **will cause** guests of small Dalmatian rentals **to** use it as their first stop during the stay and to arrange local services through it, **resulting in** fewer repetitive host messages and services booked that would otherwise not have been.
>
> **We'll know we're RIGHT if**, over the pilot season at Frane's unit (the 2027 season; proposed window May to September 2027, TBD with Frane): most Stays activate at least one guest space; activated spaces return on more than one day of the stay; a meaningful share of activated spaces completes at least one Order; and the thumbs-up ratio on answers stays high. Proposed thresholds: 60% of Stays activate, 50% of activated spaces return on a second day, 20% complete an Order, thumbs-up above 80%. **Thresholds are proposed, not confirmed.**
>
> **We'll know we're WRONG if** guests scan, ask one or two questions and never return (median one session per space); or recommendations are read but no Order is completed over a full season despite bookable Offers existing; or host messages per Stay do not fall compared with Frane's pre-Fetivi seasons; or the thumbs-down reasons are dominated by "wrong" or "outdated", which would mean the curated-data bet is failing.

### 4.2 Thesis hypothesis

> **We believe** that connecting the assistant to its services through MCP, with Fetivi as its own MCP host, **will** deliver the same task success as direct function calling on a fixed suite of guest scenarios, **while** adding measurable but acceptable overhead, and will enable things direct function calling cannot (protocol-level human confirmation, per-guest token scoping, zero-code consumption of an external server).
>
> **We'll know we're RIGHT if**, on the same task suite, model and services, the MCP build (V1) matches the direct-function-calling build (V0) on task success and tool-selection accuracy within a small margin, the added latency and tokens per turn are quantified and modest, and the integration-effort tasks (add Ferryhopper, add a provider adapter, swap the LLM vendor) are cheaper in V1. Margins are TBD; they are set before the evaluation runs, not after.
>
> **We'll know we're WRONG if** V1 is materially worse than V0 on task success, or the MCP hop adds latency guests notice, or the security tests (cross-stay access via injected Offer text, ordering without confirmation, replayed order handles, wrong-audience tokens) pass in V0 but fail in V1. A negative result is still a valid thesis finding and is reported as such.

## 5. Target users and jobs to be done

### Primary: the guest

Guests of a small rental in Trogir (later Split), typically a family or a small group, adults mostly 30 and over, arriving from Croatia, Germany, Italy, Poland, Hungary, France or English-speaking countries. They have a phone, no desire to install anything, and a Stay PIN from the host. Each person in the party has their own private space; nothing is shared across the party. The guest is anonymous by default; an email is asked for only at the first Order or alert and is required to place an Order.

Jobs to be done:

- When I arrive, I want the Wi-Fi, the door code, the house rules and how the appliances work, without asking the host again, in my language, so I can settle in.
- When I plan a day, I want suggestions that fit who we are, the weather and what is open today, so we do not waste a day of a short holiday.
- When I find something I want to do, I want to check availability, reserve and pay in the same place, so I do not spend the evening on phone calls and websites in a foreign language.
- When something in the apartment is broken or I am locked out, I want to reach the host immediately and be understood.
- When the weather or a ferry threatens my plan, I want to be told before it ruins the day.
- When I check out, I want my receipts and host replies to remain reachable.

### Secondary: the host

An owner-operator of one building with one to a few units in Dalmatia, listed on Booking.com and Airbnb, with no PMS or channel manager, working from a phone. Jobs to be done:

- When a booking comes in, I want the Stay registered and the access PIN ready with a copy-paste message, so introducing Fetivi costs me seconds.
- When I set up, I want to be told exactly what information guests need and why, so I never wonder whether the guide is complete.
- When a guest has a real problem, I want to hear about it immediately, in my language; for everything else, I want to be left alone.
- When guests keep asking something my guide does not cover, I want to be told the topic, not shown their conversations.
- When I offer my own services (a transfer, home-made goods), I want my guests to see them and nobody else's guests to.

### Tertiary: the admin

Frane, or whoever runs the platform. Owns the destination catalog, provider deals and Offers, property approval, curation and staleness queues, host accounts, usage caps, and can act as any host (logged). Jobs: keep local data true and seasonal with minimal manual effort; onboard a Provider without giving them software; notice where supply or data is missing.

### Providers are not users of the system

Providers (local businesses the admin has a deal with) have no accounts. They receive each Order through a per-order link by email and WhatsApp, respond with one tap (Accept, Decline, Suggest another time, Accept with price, Got it, Can't fulfil), and complete payment onboarding once from a link the admin sends. Hosts offering their own services are not Providers; their Orders reach the host's inbox.

### Non-users

- Hotels and resorts with front desks and PMS stacks.
- Property managers who need multi-user accounts, PMS integrations or channel management (a PMS adapter is a later enhancement, not a day-one target).
- Providers who want to self-register, manage their own Offers or run a storefront. Fetivi is not a commerce platform run by providers.
- Anyone holding the QR code without a valid Stay PIN, including the host. There is no visitor mode and no "preview as guest".
- Guests who want voice or a native app.

## 6. Scope

Frane's decision: the thesis build and the real product are one build. Nothing below is deferred on schedule grounds; features may be polished later, but all are in scope. Section 6.7 names the thinnest end-to-end slice that proves both hypotheses, as a sequencing recommendation only.

### 6.1 Guest access and identity

- One permanent QR code and link per unit. Scanning on a device with no session asks for a six-digit Stay PIN; the PIN is valid from the host's registration until the end of checkout day and is unique among the property's active Stays.
- Each device that enters the PIN gets its own private space (conversation, preferences, plans, Orders). Re-entering the PIN creates a new empty space.
- Anonymous by default. At the first Order (where email is required) or when setting an alert, one email opt-in covers recovery, confirmations and alerts. A recovery link restores the space on any device.
- Works before arrival as soon as the guest has the PIN. Arrival instructions and door codes appear from a host-set point 0 to 7 days before check-in (default 00:00 the day before); before that the Guide shows the date they appear.
- After checkout: chat closes at the end of checkout day; the space stays read-only for 30 days (My trip, receipts, host replies, action buttons on unresolved Orders), then conversation and preferences are deleted. Order records follow the retention in section 6.5.
- Brute-force limits on PIN entry per device and per property without ever locking real guests out; a soft daily message cap per space, set by the admin, after which Guide and My trip keep working.

### 6.2 Guest experience

- First screen: language picker, each language under its own name, browser language highlighted, English fallback. Interface in English, Croatian, German, Italian, Polish, Hungarian and French; the assistant answers in the chosen language; a header button switches both at any time.
- Three tabs. **Chat** is home. **Guide** (read-only, no model call): Arrival and access (time-gated), Wi-Fi and essentials, House rules and checkout, How-tos with host photos or video, Saved places, Host's top picks, Contacts and emergency. **My trip**: Plan (one living day plan per Stay day mixing booked items and suggestions) and Reservations & orders (every Order with its Order status and Payment status). All actions happen in chat; tabs only display, except "Ask Fetivi about this" on a plan item.
- Onboarding: a fixed pre-written welcome stating that Fetivi is an AI assistant (EU AI Act transparency), what it can do and that it can ask the host; four to six starter cards; one skippable "Tell me about your trip" card. No tour or popups.
- No names on the guest side. People are simply guests; party size may be used as context.
- Preferences: an optional tap-only flow plus silent inference from conversation; everything saved is visible, editable and deletable in About me. Special-category data (health, religion) is saved only when the guest taps it themselves, under a one-line note; inferred special-category data is used in that conversation only.
- Interactive components the assistant can return: follow-up chips, choice question card, place card carousel, map with list, day plan timeline, availability picker, booking confirmation card (explicit approval before any Order), receipt and status card, host message draft card, property info card with copy buttons and media, weather card. Payment is always a redirect to a hosted checkout, never a card form in chat.
- Tone: a warm local friend, first person, short, rare Dalmatian touches, the same in every language. No audio.
- Accessibility: WCAG 2.2 AA; tap targets at least 44 px; text scaling; streamed answers announced to screen readers; every map has a list alternative; the text box does not block the keyboard's own dictation.
- Answer feedback: thumbs up or down with an optional one-tap reason, stored as counts and topics, never with the guest's wording.
- Review request: one neutral line in the checkout reminder linking to the booking platform when known; no rating first, no review gating.

### 6.3 Knowledge and recommendations

- **Property facts** come only from the host's data. Otherwise "I don't have that" and a handoff offer. Fetivi never invents a place, price or availability.
- **Local facts** come first from the admin-curated destination catalog (places, beaches, events, transport notes, day trips with travel time), seasonal and source-attributed, each record with a verification date and a per-category staleness budget. Fetivi mentions "last checked <month>" only for time-sensitive facts and suggests calling ahead past the budget.
- **Web fallback** runs only when curated search returns nothing, restricted to an allowlist (tourist board, ferry operators, the national weather service, venues' own sites). Results are shown with source chips, never as place cards, never bookable, never ranked among curated picks. Every fallback is logged as a curation gap.
- **The model's own knowledge** is allowed for timeless general knowledge (food, history, culture, language) and never for a specific venue, price, time or availability unless a tool returned it.
- **Host's local knowledge**: hosts pick catalog places and add a personal note ("Your host's pick"); may add a place not in the catalog (visible to their guests at once, queued for admin curation); write area tips in a Neighbourhood tips block. Hosts cannot edit catalog entries.
- **Ranking**: fit to the request and About me, quality and distance first. Among options that fit, those bookable through Fetivi go first with an "arrange it here" action. A poor-fit bookable service is never pushed above a clearly better option; the boost depends only on being bookable, never on commission; no paid placement. The Privacy page discloses the rule.
- **Weather** from the national meteorological service (warnings, sea temperature, UV) and a point-forecast source, both credited. **Transport** timetables are curated text with links, checked each season, never computed into journey plans.
- Properties outside any destination can go live with Guide, host picks, handoff and web fallback; curated recommendations and bookable Offers exist only inside a destination.

### 6.4 Services and Orders

Terms follow `GLOSSARY.md`: Offer, Provider, Category, Order, Order kind, Order status, Payment status, Stay.

- Guests can order local services in chat: the four Order kinds are **booking** (a time slot with capacity), **ticket** (a fixed event), **purchase** (goods delivered or picked up) and **request** (needs a price or approval first). Categories such as tour, dining experience and transfer classify the Offer independently.
- Providers are admin-managed. The admin makes the deals and owns Provider and Offer data.
- Three availability modes per Offer: **live** through the Provider's own booking system (instant), **allotment** entered by the admin from the deal (instant, Provider informed), **on request** (Provider must accept within an admin-set response window, default 30 minutes within 08:00 to 21:00, always under 4 days; a missed window alerts the admin, who can phone and record the answer).
- Provider responses via a per-order link (valid until the Order is final, unguessable, no login): on request shows Accept, Decline, Suggest another time; allotment shows Got it, Can't fulfil (a Provider cancellation with full refund and admin alert); request kind shows Accept with price. A new time or price returns to the guest as a new confirmation card.
- No Order is created without the guest's explicit tap on a confirmation card. The confirmation shows the email (required) and the contact details the admin configured for that Offer (name, phone or both), used for that Order only. A retried request never creates a second Order.
- An Order's date must fall within the Stay. Guest cancellation follows the per-Offer policy the admin writes from the deal, through the same confirmation card.
- Order status: awaiting confirmation, then confirming (instant) or pending provider (on request), then confirmed, declined, expired or failed, then cancelled or completed. Payment status, independent: none, authorized, captured, voided, refund pending, refunded, failed.
- Payment: per Offer, **pay the Provider directly** (no money in Fetivi; commission invoiced monthly to the Provider) or **pay online**. Pay online is authorize, confirm, then capture for every Order: the guest authorizes on a hosted checkout, Fetivi confirms the Order, only then is payment captured; decline, failure or expiry voids the authorization, so a guest is never charged for an unconfirmed Order. The Provider is merchant of record and issues the receipt; Fetivi never holds other people's money. Seat hold during checkout is 30 minutes. Refunds follow the Offer's policy and include Fetivi's fee.
- **Host's own services**: registered in the host back office, visible only to that host's guests, same Order kinds, Orders go to the host's inbox, no Fetivi commission. Hosts may connect their own online-payment account.
- **Host control over Providers**: opt-out. Every admin-approved Provider in the destination is available to every host's guests; a host can hide specific Providers and can suggest a Provider to the admin. No host share of Provider commission.
- **Ferry integration**: one real external MCP server (Ferryhopper, read-only) for itineraries, prices and disruptions, treated as untrusted and attributed in Fetivi's wording.

### 6.5 Notifications, handoff and safety

- Channels: an in-chat inbox (always stored, badge on Chat); email as the source of truth for Orders and recovery; web push on Android only, offered once when the guest asks for an alert. No WhatsApp or SMS for guests. No channel prompt on first load; a declined offer is never repeated.
- Transactional, always sent: Order confirmed, changed or cancelled; reminder before a booked item; host reply; arrival details available; checkout reminder.
- Safety, always sent to every space in the Stay: official weather warnings; ferry or catamaran disruptions that affect a plan item or an Order, attributed to their source (weather service advisory, Jadrolinija's own notice, Ferryhopper's report). Fetivi never states a cancellation in its own voice; for Orders, the Provider's own cancellation is the only truth.
- Suggestions (rainy-day ideas, matching events, gaps in tomorrow's plan): at most one per day per space, inbox only by default and only to spaces used in the last 48 hours; by email only with a separate unticked opt-in, one tip a day, one-click unsubscribe.
- **Handoff to the host** is never automatic: a message reaches the host only after the guest taps Send on a draft. Offered only for property questions without data, problems, requests, or when the guest asks; never for general local questions; never twice in one conversation. Relayed through Fetivi with translation both ways; Fetivi sets urgency (urgent bypasses the host's digest). Emergencies show 112 and the host's phone first, with no draft. The guest sees "Sent" then "Read"; Fetivi never claims the host has seen a message.
- Hosts see only the messages guests explicitly send. No transcripts. Content gaps reach the host as topic-level suggestions written by Fetivi, never quoting guests, and only after a topic came up in at least two different Stays.
- Out-of-scope requests (medical, legal, unrelated) get a brief friendly decline pointing to 112 or the host where relevant.
- Retention: conversations and preferences 30 days after checkout; minimal Order records 11 years for commission accounting; conversations kept for thesis evaluation only with the guest's opt-in, otherwise aggregate counts.

### 6.6 Back office (hosts and admin)

One back-office web app with Host and Admin roles; host parts mobile-first. The guest app is separate.

**Host**

- Self sign-up with email verification; one login per host account. A unit goes live (QR issued, Stays registrable) only after the admin approves the property once.
- Hierarchy: Host → Property (building: address, location, parking, shared rules and how-tos) → Unit (QR code, Stays, Wi-Fi, appliances, unit-specific content). Units inherit and may override.
- Property data: a structured core (check-in and checkout times, check-in method, access instructions, Wi-Fi, contacts, parking, house rules, occupancy, beds and bathrooms, licence number), amenities from a controlled list with notes, and typed info blocks (category, title, rich text, media, visibility time) whose categories map one to one onto the seven Guide sections.
- A guided wizard, one step per Guide section, every field marked Required, Recommended or Optional with "why guests need this" and an example; questions depend on property type; an optional paste-or-upload of an existing house manual pre-fills drafts the host must confirm; a completeness bar; leave and resume. No import from a listing URL.
- Minimum to go live: address, check-in time, check-in method and access instructions, checkout time, Wi-Fi or "no Wi-Fi", host phone, translations done.
- The host writes in one language; Fetivi translates every block into the seven guest languages on save and stores them (no model call at display time). Secrets (passwords, codes, phone numbers) are typed fields and never translated. The host may correct a translation.
- Stays and PINs: manual registration (dates, party size, optional booker name or reservation number) and calendar-assisted registration from Airbnb and Booking.com iCal exports polled about every 30 minutes. Each new event becomes a proposed Stay with Confirm and "Not a booking"; two feeds with identical dates merge; date changes keep the PIN and notify the host; a vanished event marks the Stay "possibly cancelled" and the PIN keeps working until the host confirms. After Confirm the PIN is shown large with a copy-ready hand-over message (unit link, PIN never inside the link, a line that Fetivi is optional) in the guest's likely language; a fallback without the link exists for OTA message filters. A guided Booking.com domain-approval step is shown to hosts with a Booking.com calendar. Warning from 3 days before check-in for Stays still awaiting a PIN.
- Handoff inbox: Immediate or Digest at host-chosen times (default 09:00, 14:00, 19:00); urgent bypasses; replies only in the inbox (no reply-by-email); translation both ways.
- Host picks and neighbourhood tips; own services; notification settings (email always, web push via Home Screen install as a guided step; no SMS or WhatsApp); Suggestions (content gaps with a button to the right wizard step); aggregate stats per unit (conversations per Stay, top topics, thumbs ratio; never transcripts).

**Admin**

- Everything a host can do, for any host, via a logged "act as host"; runs the wizard on a host's behalf when needed.
- Destinations (a centre plus radius, about 15 km for Trogir) and the catalog. Seeding: import candidates from open data sources and de-duplicate; tick what to draft; a background drafting job fills a structured draft with a source URL per field, fetching only from the venue's own site and socials and the tourist board; a review queue with Approve, Edit, Reject, Needs a visit that stamps the verification date; a pre-season Refresh that queues only diffs. Open-data-derived fields kept separate for licence reasons. Place images only from Frane's photos, venue-supplied with permission, or Wikimedia Commons with attribution; otherwise a category illustration.
- One curation queue with filters: drafts, refresh diffs, places flagged outdated by guests, host place suggestions, host Provider suggestions, web-fallback topics clustered weekly. A staleness queue sorted by staleness times recommendation frequency.
- Providers and Offers: deals, availability mode, response window, payment mode, cancellation policy, which guest contact details the Provider receives; Provider payment onboarding links; missed-window and failure alerts.
- Property approval, host accounts (suspend, delete), usage caps.

### 6.7 The proof slice (sequencing recommendation, not a cut)

Recommended in planning, not yet accepted by Frane: build the thesis core end to end first, then layer everything else. The thesis core is the thinnest line that proves both hypotheses:

1. A guest enters a Stay PIN and asks about the unit; answers come only from host data entered in the back office.
2. The guest asks for a recommendation; it comes from the curated catalog, personalised by About me and Stay dates.
3. The guest asks to book one real local Offer; Fetivi checks availability, shows a confirmation card, the guest approves, the Order is created and confirmed, and the Provider learns of it.
4. The admin interface maintains the property, catalog and Offer data behind steps 1 to 3.
5. The same scenarios run in the direct-function-calling build and the MCP build, and the measurements in section 7 can be taken.

Everything in sections 6.1 to 6.6 follows. The order of the rest is for the architecture and story-slicing sessions.

### 6.8 Thesis requirement traceability

| Requirement in `master-thesis.md` | Where it is met |
|---|---|
| Guests communicate in natural language | 6.2 Chat home, seven languages |
| Information about their accommodation | 6.3 property facts from host data; 6.2 Guide tab |
| Personalised recommendations based on local data | 6.3 curated catalog, About me, ranking |
| Access to restaurants, excursions, transportation, local events, and services offered by hosts | 6.3 catalog and transport; 6.4 Offers by Category and host's own services |
| Perform actions through services connected via MCP: check availability, make reservations | 6.4 Orders with availability modes; 11 MCP decisions; 7 evaluation |
| Property information, recommendations and services entered and maintained through a separate administrative interface | 6.6 back office, Host and Admin roles |
| Demonstrate MCP as a bridge between assistant and web services, for data retrieval and execution | 4.2 thesis hypothesis; 7 evaluation; 11 |

## 7. Success metrics

Outcome-shaped, each with a target and a measurement. Pilot targets marked **proposed** need Frane's confirmation before the pilot starts.

### Thesis evaluation (same task suite, model and services across V0 direct function calling, V1 Fetivi over MCP, V2 the same servers through a third-party MCP connector)

| Metric | Target | Measured by |
|---|---|---|
| Task success on about 40 scripted guest scenarios | V1 within a pre-set margin of V0 (margin TBD, fixed before the run) | Database end state per scenario |
| Tool-selection accuracy and number of calls | V1 within margin of V0 | Trace comparison per scenario |
| Tokens and latency per turn, including the MCP hop | Quantified; overhead reported, acceptability judged against guest-visible latency (threshold TBD) | Instrumentation on every turn |
| Integration effort: add Ferryhopper, add a Provider adapter, swap LLM vendor | V1 cheaper than V0 on lines changed and hours | Logged during the work |
| Security tests: cross-stay access via injected Offer text, ordering without confirmation, replayed order handles, wrong-audience tokens | All fail safely in V1 | Scripted attack scenarios |
| Protocol conformance | Pass | MCP Inspector |
| V2 capability coverage | Reported: which tasks a provider connector cannot carry (no elicitation) | Task list |

### Product pilot (Frane's unit, 2027 season)

| Metric | Target | Measured by |
|---|---|---|
| Stays with at least one activated guest space | **proposed** 60% | PIN entries per registered Stay |
| Activated spaces that return on a second day | **proposed** 50% | Session days per space |
| Activated spaces that complete at least one Order | **proposed** 20% | Orders reaching confirmed |
| Thumbs-up ratio on answers | **proposed** above 80%, with "wrong" or "outdated" under 5% of answers | Feedback counts |
| Host messages per Stay | Lower than Frane's pre-Fetivi seasons (baseline TBD from Frane's message history) | Handoff count plus OTA inbox count |
| Curated-data coverage | Web fallback used in under a set share of local questions (**proposed** 10%) | Fallback log |
| Content-gap loop | Every topic surfaced to the host as a Suggestion is answerable after the host acts | Suggestion resolution |

## 8. Non-goals

Explicitly dropped during planning so they are not revived by accident:

- Visitor mode for anyone holding the QR code; an open QR code attaching to whatever Stay is active; automatic per-stay links; a link with the PIN inside; per-stay rotating door codes.
- Names on the guest side; greeting by name; "preview as guest" for hosts.
- WhatsApp or SMS to guests; web push on iPhone; channel prompts on first load.
- Automatic handoff to the host; transcripts or lists of unanswered questions visible to hosts.
- Import of property data from a listing URL; Google Maps grounding; storing or hotlinking Google or Tripadvisor photos.
- Several users per host account; hosts registering or opting in to Providers; host share of Provider commission.
- Provider accounts, Provider self-service or a Provider storefront; a Fetivi contract that every Provider implements as its own MCP server.
- Building Fetivi's own interface components as MCP Apps.
- A "payment link after acceptance" flow; Fetivi collecting money on its own account.
- Computed journey plans from timetables; stating ferry cancellations in Fetivi's own voice.
- Spoken audio; a native app; a custom microphone button.
- A separate "thesis MVP" with cut features. Scoping by deadline.
- A thesis paragraph about the missing maritime real-time feed.
- OTA API integration and PMS-driven stay import as day-one requirements (a PMS adapter is a later enhancement and may be trialled during development).

## 9. Open questions

Product and thesis questions that remain open. The stack belongs to the architecture plan.

- [ ] **Pilot thresholds and window.** Confirm or change the proposed targets in sections 4.1 and 7 and the pilot season window, and establish the host-messages-per-Stay baseline from Frane's past seasons.
- [ ] **Evaluation margins.** Set the V1-versus-V0 success and latency margins before the evaluation runs.
- [ ] **Build order.** Accept or change the recommended "thesis core first" sequencing (section 6.7).
- [ ] **How Fetivi gets reservation data as a business** for customer hosts: calendar files only, the host's existing PMS, Hospitable Connect (Airbnb only), or Channex (Fetivi as channel manager). Recommended next steps, not yet accepted: ask about ten hosts which software they use; email Hospitable about Connect.
- [ ] **Travel-agency licensing.** Under the Croatian tourism services act only a registered travel agency may broker or reserve excursions and transport, even without handling payment; tickets and goods are unaffected. Recommended, not accepted: ask the Ministry of Tourism for a written opinion on commission-only platforms, then register as an online travel agency or partner with a local agency. Does not change the build.
- [ ] **Host services legal gates.** Paid transfers by private renters and sale of homemade spirits are restricted; Frane will regulate these later. No gates for now.
- [ ] **Permissions to obtain:** Jadrolinija (written permission to poll its RSS feed); the Trogir tourist board (reuse of its event calendar); Ferryhopper's terms for its MCP server and widgets.
- [ ] **Tests to run:** whether Booking.com keeps the iCal UID when a Stay's dates change; whether Ferryhopper's disruptions cover Croatian lines and how current they are; WhatsApp Business verification and per-message cost for Provider order links.
- [ ] **Pilot data thinness.** If Trogir's local data is too thin, extend the destination to Split (decided in principle; trigger not defined).

## 10. Risks the architecture must de-risk

Named here so the architecture session can decide what to spike versus build. One-way doors first.

- **Confirmation inside the protocol.** Order confirmation through MCP elicitation is the single feature that distinguishes V1 from "function calling with extra steps". Known client-library limits (see section 11) make this a spike before anything is built on it.
- **MCP Apps for external UI** (Ferryhopper widgets) in a custom host on a separate origin: untested in this project.
- **Authorize-confirm-capture against Providers who answer by tapping a link**, with hold windows, expiry and idempotency across the payment provider, Fetivi and Providers' booking systems: easy to get subtly wrong; needs a state model spike.
- **Cached system prompt containing the whole unit record** with an authorized guest projection (no unreleased codes), rebuilt when codes are released: cost and correctness need checking.
- **Translation pipeline on save for seven languages** across rich-text blocks with secrets excluded.
- **Catalog seeding from open data with licence separation** (share-alike fields kept apart) and a drafting job that fetches only from allowlisted sources.
- **Calendar sync edge cases** (merges, date changes, vanished events) against two feeds that look identical for blocks and bookings.
- Two-way doors (just build): the eleven interface components, the Guide and My trip tabs, the wizard, notification channels, feedback, review request.

## 11. Decisions already made that bind the architecture

These were settled by Frane during planning. They are repeated here so the architecture plan honours them rather than re-opening them. Everything not listed is the architecture plan's to decide.

- **Fetivi is its own MCP host.** The chat backend runs the MCP clients; the LLM sees tools through ordinary tool calling. A third-party provider connector is not the core (tools only, public servers needed, client invisible).
- **Four first-party servers in one deployment, plus one external:** `stay` (unit record as a resource, host message draft tool, time-gated arrival details), `local` (catalog search, events, weather, transport, allowlisted web fallback that logs curation gaps), `services` (Offers, availability, Orders, cancellations; write tools with elicitation; Provider adapters for live, allotment and on request live inside it), `trip` (day plan and About me, private to the space), and Ferryhopper (external, read-only, untrusted output, tool list pinned). Reason, as corrected in re-validation: one trust policy and a narrow token per server; the split does not by itself keep Provider text away from private data, because both meet in the model's context.
- **Per-guest scoping:** per conversation, a short-lived token per server (audience that server, subject the guest's space, claims for Stay, unit and destination, narrow scopes). Tools carry no guest, unit or Stay identifiers. Tool lists vary by situation (no `services` write tools outside a destination unless the host has own services; read-only plus "manage existing Orders" scopes after checkout). About 15 to 20 tools, loaded up front.
- **Boundary enforcement:** ownership checks in every tool against token claims; approved-action binding (a confirmation completes the stored pending Order, never parameters the model re-sends); egress only to allowlisted destinations, the host message being the only free-text outbound after the guest taps Send; the prompt receives an authorized guest projection of the unit record.
- **Rendering:** first-party tools return structured content and the host renders Fetivi's own components, reused in the tabs; external servers' UI (Ferryhopper widgets) renders as MCP Apps through the official app bridge in a sandboxed iframe on a separate origin.
- **Payments:** Stripe Connect direct charges with the Provider as merchant of record and Fetivi's commission as an application fee; authorize, confirm, capture with a 30-minute checkout hold; Stripe-hosted checkout only. Idempotency with external systems (payment idempotency keys, Fetivi's reference sent to Provider systems) is an architecture detail.
- **Order idempotency:** the `services` server is idempotent on the order handle.
- **Property data in the prompt:** the whole unit record (guest projection) goes into the cached system prompt; no retrieval for property data. Stored translations, no model call at display time.
- **Local data sources:** OpenStreetMap, the official bathing-water list, Overture/Foursquare for seeding (open-data fields kept in separate columns or tables); DHMZ and MET Norway for weather; Jadrolinija RSS only with permission; no Google Maps grounding; no Open-Meteo (non-commercial licence).
- **Evaluation design:** V0 confirms through Fetivi's own app against the same backend rule; V1 through elicitation; V2 runs only the tasks it supports, the rest reported as a finding. "App confirmation" versus "protocol confirmation" is itself measured.
- **Facts for the architecture session, not decisions:** the official MCP client needs automatic version negotiation to speak the 2026-07-28 revision; one popular SDK adapter cannot carry elicitation (`input_required`), so it cannot carry Order confirmation; the servers' legacy initialize path must stay on so the V2 connector can reach them; the MCP UI client library lags the SDK major version.
