# Fetivi

An AI assistant for guests in short-term accommodation that answers questions about the stay and the destination and arranges local services.

## Hosts and properties

**Host**:
An account that runs one or more Properties and enters the information guests are answered from.
_Avoid_: Owner, landlord, user

**Property**:
A place a Host rents out, at one address and in one time zone, of one Property type, holding the content its Units share.
_Avoid_: Building (except in the physical sense), listing

**Unit**:
One rentable space of a Property. It inherits the Property's content and may override it field by field, or hide or replace the Property's Info blocks.
_Avoid_: Apartment (as the generic term), room, listing

**Info block**:
A titled piece of Markdown guest information in one Guide section, owned by a Property or a Unit, with a revision number that grows with every edit of its title or text, every added Block media item and every caption change.
_Avoid_: Article, note, card

**Block media**:
A photo or short video a host attaches to an Info block, with a caption that is translated like the block's text; guests see it from the publication of the revision that added it.
_Avoid_: Attachment, upload

**Translation**:
One guest language's version of an Info block's title, text and Block media captions, for one revision: the host's own text, a machine translation, or the host's correction (which keeps the machine captions). A host's free-text field (access, parking, house-rule and amenity notes) also has a Translation per language, served only while it was made from the field's current text.

**Field text**:
A Property's or Unit's own short free-text note that guests see (access instructions, parking notes, other house rules, or the note on one amenity), with a revision that grows with every change of its text. Its Translations are made by machine only; the host corrects one by editing the note.
_Avoid_: Free-text field (in code and API names), note (alone)

**Published revision**:
The revision of an Info block guests see; it moves forward only when all seven languages exist for a newer revision.

**QR link**:
A Unit's permanent guest link, issued when the Unit goes live (see Go-live minimum) and printed as a QR code.
_Avoid_: Invite link, booking link

**Go-live minimum**:
What a Unit needs before it goes live: approved Property, address, check-in time, check-in method and access instructions, checkout time, Wi-Fi or "no Wi-Fi", host phone, and every Info block's current revision published. Live is one-way.
_Avoid_: Launch checklist

**Property type**:
Apartment, studio, house, villa, room or guesthouse; decides which setup questions a Host is asked.

**Setup wizard**:
The guided per-Unit form, one step per Guide section, each field marked Required, Recommended or Optional.

**House manual import**:
A Host pastes or uploads an existing house manual; Fetivi turns it into Drafts for the Setup wizard.

**Draft**:
A value or Info block proposed from a house manual, marked "From your manual". Nothing in a Draft reaches guests until the Host confirms it; confirming a block starts its Translation.
_Avoid_: suggestion (that is Suggestions' term). The catalog's `draft` Curation item, which the drafting job fills from a venue's own pages, is a different thing and is not a Draft.

**Content gap**:
A property fact a guest asked about that the Host never entered, noted by Fetivi as a topic code (a Setup wizard field such as laundry or parking) once per Stay, never with the guest's or Fetivi's wording (`content_gaps`). It outlives the Conversation.
_Avoid_: missing question, unanswered question

**Suggestion**:
What a Host sees once the same Content gap has come up in at least two Stays of a Unit: one sentence written by Fetivi in the Host's back-office language, with a button to the Setup wizard field. It is resolved when the Host fills that field; later gaps count afresh. The code names it `HostSuggestion` / `host_suggestions`, since `suggestion` is taken by Plan items.
_Avoid_: tip, recommendation, insight

## Local knowledge

**Destination**:
An area, a centre plus a radius, with one shared catalog. Its time zone is the one event times are entered in.
_Avoid_: Region, city

**Catalog record**:
A place, event, transport note or day trip in a Destination's catalog, kept by the admin, with a verification date and a source URL per field. Its title and description are translated like an Info block.
_Avoid_: Listing, POI

**Place category**:
The classification of a place: beach, restaurant, café or bar, sight, nature, activity, shop or nightlife. It is not the Offer **Category**.

**Verification date**:
When the admin last checked every field of a Catalog record; one date for the whole record.

**Staleness budget**:
How long after its Verification date a Catalog record stays trustworthy, set per Place category or kind. Events have none; they end.

**Staleness queue**:
The Catalog records past or within 14 days of their Staleness budget (never-verified ones count as past it), ranked by budget used × (1 + Recommendation count over 90 days), so the most out-of-date records guests see most come first. Events are left out.

**Host pick**:
A published Catalog record a Host recommends to the guests of one property, with an optional note translated like an Info block. It carries a "Your host's pick" badge and is ranked by the same rules as any other place.
_Avoid_: favourite, recommendation (that is the Recommendation count)

**Host-added place**:
A place a Host adds that is not in the catalog. Only that property's guests see it, marked as added by the host and unverified, and it goes on the curation queue as a host place suggestion. Once approved and published, it shows as a Host pick of the new record.

**Neighbourhood tips**:
The Host's free-text Info block about the area, shown in the Host's top picks section of the Guide.

**Recommendation count**:
How many times a place or day trip was returned by a guest's place search, counted per day in the Destination's time zone. It tells the admin which records to re-check first.

**Weather report**:
The weather at a Property: a point forecast from MET Norway, and the sea temperature, UV index and official warnings from DHMZ. Each part may be unknown when its source does not answer; unknown warnings are never "no warnings".
_Avoid_: Forecast (for the whole report)

**Warning area**:
The DHMZ warning regions a Property falls in, a county and a marine region, taken from the nearest coastal reference town. A Property with no town close enough has unknown warnings.

**Ferry line**:
A ferry or catamaran line by its state line number (9603) or, without one, its operator's route (Bura Line). Day trips and transport notes record the lines they depend on, so Safety alerts can match a Ferry bulletin to a guest's plan.
_Avoid_: route, connection

**Ferry bulletin**:
An item in a ferry operator's own news feed (Jadrolinija's RSS), in Croatian, that may name lines and days. Untrusted input: only its title and link reach the guest, quoted and attributed.
_Avoid_: notice (a Notice is Fetivi's inbox message)

**Web fallback**:
A search of allowlisted sites (tourist boards, ferry operators, DHMZ, venues' own sites) through Brave, used when curated search has no answer and as the only local source outside a destination. The query is topic keywords plus a place, never private data. Results are unchecked links with a source chip, never recommendations and never bookable.
_Avoid_: web search (for the whole feature)

**Ferry widget**:
Ferryhopper's own sailings card (an MCP App), shown in the Chat in a sandbox on its own origin. Its data is Ferryhopper's and untrusted; booking continues on Ferryhopper's site, and Fetivi earns nothing from it.
_Avoid_: ferry card (Fetivi has no ferry component of its own), booking widget

**Curation gap**:
A question the catalog could not answer, recorded as one `fallback_log` row per Web fallback call (topic, place, time, outcome; no guest wording). Admins use them to see what to curate next.

**Fallback topic cluster**:
The Curation gaps of one Destination and one ISO week whose topics share the same set of words ("kayak rental", "rental kayak"), grouped by a weekly job into one Curation item with counts and sample topics and places.

**Seeding candidate**:
A place found in open data (OpenStreetMap, the EEA bathing-water list, Overture Maps) for one Destination, grouping the Open-data rows that describe it. Its name and coordinates stay in the open-data table, apart from the curated catalog. The admin ticks it to send it to drafting.
_Avoid_: suggestion (that is a host's)

**Open-data row**:
One place as one open-data source lists it, with its source, licence and fetch time; attached to a Seeding candidate or a Catalog record.

**Drafting run**:
One admin-started batch of catalog drafting or pre-season refresh for a Destination: a tick sent to drafting, "Draft waiting" or "Start refresh". It takes at most 25 records; the rest wait for the next run the admin starts.
_Avoid_: batch job, import (an import fetches open data, a drafting run reads venue pages)

**Refresh diff**:
The changed factual fields of a verified place (title, address, phone, website, opening hours, seasons) that the pre-season refresh found on its venue pages, queued as one Curation item with the previous values. A field the pages do not mention is not a change.
_Avoid_: update, sync

**Answer feedback**:
A guest's thumbs up or down on one Fetivi answer, with an optional one-tap reason (wrong, outdated, not helpful). Stored per answer as counts and topics (`answer_feedback`), never with the guest's or Fetivi's wording; it outlives the conversation. Outdated or wrong on an answer that showed catalog places flags them on the curation queue.

**Answer topic**:
What an answer was about, derived from the tools it used (Wi-Fi, beaches, ferries…), never from the guest's words; host and admin stats count them.

## Services

**Order**:
One guest interaction with a service, whatever its kind. "Reservations & orders" is only the interface label for the list of them.
_Avoid_: Booking (as the umbrella term), reservation, transaction

**Order kind**:
The shape of an Order: **booking** (a time slot with capacity), **ticket** (a fixed event), **purchase** (goods delivered or picked up) or **request** (needs a price or approval first).
_Avoid_: Order type

**Order status**:
Where an Order is in its lifecycle: from awaiting confirmation through confirming or pending provider, to confirmed, declined, expired or failed, and finally cancelled or completed. Independent of Payment status.

**Payment status**:
Where an Order's money is: none (paid to the provider directly, or not yet authorized for a pay-online Order), authorized, captured, voided, refund pending, refunded or failed (a refund Stripe could not make). A payment is captured only after the Order is confirmed.

**Payment attempt**:
One Stripe Checkout Session and its payment intent for one proposal of a pay-online Order. Its `expires_at` is stored before Stripe is called and is also when the inventory hold expires.
_Avoid_: Payment, charge, transaction

**Refund rule**:
The structured part of an Offer's cancellation policy, snapshotted on the Order: free until a number of hours before the start, then a percentage. Refunds are computed from it, never from the policy text.
_Avoid_: Refund policy, cancellation terms

**Reconciliation finding**:
One disagreement between Fetivi and Stripe or a hold, found by the reconciliation job: what it was, and what was done about it.
_Avoid_: Discrepancy, mismatch

**Order ledger**:
The minimal record of an Order kept for 11 years for commission accounting once its Space is deleted: Offer, date, quantity, price, both statuses, Provider and email (`order_ledger`). It has no foreign keys, so it outlives the Space, the Stay and the Offer.
_Avoid_: archive, order history

**Offer**:
A service a Provider or host makes available to guests, with its category, availability mode, payment mode and cancellation policy.
_Avoid_: Product, listing, upsell

**Provider**:
A local business the admin has a deal with and whose Offers guests can order. A host offering their own services is not a Provider.
_Avoid_: Partner, supplier, vendor

**Own service**:
An Offer a host makes available only to their own guests. Its Orders reach the host's inbox, where the host answers as the Provider would, and Fetivi takes no commission on it.
_Avoid_: host Provider, host Offer (in interface copy)

**Hidden Provider**:
An approved Provider a host has hidden from their guests. Hiding is per host, changes only what guests see from then on, and never touches existing Orders.
_Avoid_: blocked Provider, opt-out (as a noun)

**Curation item**:
One entry on the admin's single curation queue (`curation_items`). Six kinds: a draft, a refresh diff, a record flagged by guests, a host's place suggestion, a host's Provider suggestion and a Fallback topic cluster. An item is open, needs a visit (parked, still reviewable), approved or rejected; there are no assignees, so whoever acts first wins. Approving an item tied to a Catalog record applies what it proposes and stamps the record's Verification date.
_Avoid_: suggestion (as the umbrella term), ticket

**Category**:
The catalog classification of an Offer, such as tour, dining experience or transfer. Independent of Order kind.

**Allotment slot**:
One start time of an allotment Offer with its seat capacity and the seats remaining, from the Provider's deal.
_Avoid_: Departure, session, timeslot

**Response window**:
How long a Provider has to answer an on-request Order, counted only within the Offer's daily response hours in the property's zone and always ending under 4 days after the request (clamped to 96 h). The deadline is stored on the proposal as `response_due_at`.
_Avoid_: SLA

**Provider link**:
The unguessable per-Order link a Provider receives by email, opening a no-login page bound to the Order's current proposal; valid until the Order is final.
_Avoid_: Magic link, login link

**Stay**:
One guest party's registered visit to a unit, from check-in to checkout, identified by its PIN.
_Avoid_: Reservation, booking

**Active Stay**:
A Stay from its registration until the end of its checkout day in the Property's time zone; its PIN works and is unique among the Property's Active Stays.

**Calendar feed**:
A Unit's Airbnb or Booking.com iCal export link that Fetivi reads about every 30 minutes.
_Avoid_: Sync, channel

**Proposed Stay**:
A calendar event, or the events of several feeds with identical dates, awaiting the Host's Confirm or "Not a booking".
_Avoid_: Pending booking

**Possibly cancelled**:
A Stay whose calendar event disappeared; its PIN works until the Host cancels or keeps it.

**Hand-over message**:
The copy-ready text a Host sends a guest party with the Unit's link and the PIN, never the PIN inside the link, in one of the seven guest languages.
_Avoid_: Invitation, welcome message

**Space**:
One device's private world inside a Stay, opened by entering the Stay's PIN on that device; a new PIN entry always opens a new, empty Space. It closes at the end of the Stay's checkout day, stays readable for the Read-only period and is then deleted with its Conversation, About me and Orders (each Order leaves an Order ledger row). A Recovery link moves it to another device.
_Avoid_: Session, account, profile

**Read-only period**:
The 30 days after a Space closes. The chat can be read but not written; My trip, receipts and host replies stay, and an unresolved Order can still be cancelled or its new terms answered from My trip. When it ends the daily retention job deletes the Space, unless an Order or payment is still unsettled, in which case it waits for the next day's run.
_Avoid_: grace period, archive

**Evaluation opt-in**:
The Settings toggle, off by default, that keeps a copy of a Space's Conversation (the guest's and Fetivi's messages only, no email or About me) for the thesis evaluation when the Space is deleted. It can be turned on or off until then.
_Avoid_: research consent, data donation

**Email opt-in**:
The one consent, given on the first Order's card or when the guest asks for updates, that lets Fetivi use a Space's email for Order confirmations, recovery and updates. Updates are emailed only once the address is confirmed by link. Daily tips by email are a separate opt-in, off by default.
_Avoid_: account, registration, subscription

**Recovery link**:
A single-use emailed link, valid for an hour, that moves a Space to the device that opens it, also during the read-only period after checkout.
_Avoid_: login link, magic link

**Situation**:
Where a Space stands at a given moment — before arrival, in the Stay, or after checkout, inside or outside a Destination, with or without the Host's own Offers — which decides the scopes its tokens carry.
_Avoid_: context, state

**Guest projection**:
The part of a Unit's record a guest may see at a given moment, in the guest's language: no private Host fields, and arrival details and codes only from the release time. Before then it says only whether anything is **held back** (some gated item has a value), never which item or what it holds.
_Avoid_: guest view, public record

**Conversation**:
One Space's ongoing chat with Fetivi: the guest's messages, Fetivi's answers and the notes that tell the model what changed. Each Space has exactly one, read-only once the Space closes.
_Avoid_: chat session, thread

**Daily message cap**:
How many messages a Space may send Fetivi in one day of the property's time zone, one number set by the admin (60 by default). After it the chat says so politely; card answers, the Guide and My trip keep working.
_Avoid_: rate limit, quota

**About me**:
What a Space's guests chose to share about their trip — who is travelling, interests, pace, budget feel and Needs — kept per Space, always visible to them, and changeable and removable by them. Fetivi may save the ordinary preferences it hears in the Conversation; it never saves a Need.
_Avoid_: profile, preferences, persona

**Need**:
A special-category About me item (diet for health or religious reasons, accessibility). Stored only when the guest taps it in themselves; a Need Fetivi only heard about is used in that Conversation and never saved.
_Avoid_: restriction, requirement

**Saved place**:
A Catalog record (a place or a day trip) a Space's guests saved from a place card, kept per Space for the Guide and My trip. It is stored by the record's id, so the API's `placeId` and the table's `record_id` name the same thing.
_Avoid_: favourite, bookmark

**Day plan**:
A Space's timeline for its Stay: one day per Stay day, each with its Plan items in time order, then the "any time" ones. The guest sees it in My trip → Plan and as a timeline in chat; it stays readable after checkout but can no longer be changed.
_Avoid_: itinerary, schedule, agenda

**Plan item**:
One entry on a Day plan: something agreed in chat (stored, optionally linked to a Catalog record or an Offer) or a confirmed or completed Order shown on its day (built at read time, never stored, changed only through the Order). A Plan item is not a booking. The code names the agreed kind `suggestion`; that word collides with Draft's _Avoid_ and is a candidate for renaming.
_Avoid_: activity, event

## Host communication

**Host message**:
What a guest sends their Host through Fetivi after checking, editing and tapping Send on a draft Fetivi wrote, translated into the Host's back-office language. At most one per Conversation; the Host may answer it with one reply.
_Avoid_: handoff ticket, support request

**Urgency**:
How soon a Host message needs the Host: normal or urgent, set by Fetivi, never by the guest. Urgent ones bypass the Host's Digest.
_Avoid_: priority

**Digest**:
The host's bundled email and push at the times they chose, listing Host messages still waiting; urgent ones bypass it.
_Avoid_: summary, batch

**Inbox**:
On the Host side, the back-office list of Host messages. On the guest side, inbox messages in the Chat, such as the Host's reply, which the Chat badge counts.
_Avoid_: notifications tab, mailbox

**Notice**:
An inbox message from Fetivi about the guest's Orders or Stay: a booking confirmed, changed or cancelled, the reminder the evening before, arrival details ready, the checkout reminder, Safety alerts and Daily tips. Also sent by email, and by push on Android when the guest asked for alerts. Never shown to the model.
_Avoid_: alert, system message

**Safety alert**:
A Notice about an official weather warning, or a Ferry bulletin touching a plan item or Order; sent to every open Space in the Stay; always attributed to its source, in the source's own words.
_Avoid_: cancellation notice (Fetivi never states a cancellation)

**Daily tip**:
A Notice with one rule-picked catalog idea for tomorrow (rain plans, an event matching About me, or an empty day), at most one a day per Space; inbox by default, email only with its separate opt-in, never push.
_Avoid_: suggestion (that is Suggestions' term), push tip
