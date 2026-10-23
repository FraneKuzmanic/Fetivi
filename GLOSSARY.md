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
One guest language's version of an Info block's title, text and Block media captions, for one revision: the host's own text, a machine translation, or the host's correction (which keeps the machine captions).

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
_Avoid_: suggestion (that is Suggestions' term)

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

**Curation gap**:
A question the catalog could not answer, recorded as one `fallback_log` row per Web fallback call (topic, place, time, outcome; no guest wording). Admins use them to see what to curate next.

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
Where an Order's money is: none (paid to the provider directly, or not yet authorized for a pay-online Order), authorized, captured, voided, refund pending, refunded or failed. A payment is captured only after the Order is confirmed.

**Offer**:
A service a Provider or host makes available to guests, with its category, availability mode, payment mode and cancellation policy.
_Avoid_: Product, listing, upsell

**Provider**:
A local business the admin has a deal with and whose Offers guests can order. A host offering their own services is not a Provider.
_Avoid_: Partner, supplier, vendor

**Category**:
The catalog classification of an Offer, such as tour, dining experience or transfer. Independent of Order kind.

**Allotment slot**:
One start time of an allotment Offer with its seat capacity and the seats remaining, from the Provider's deal.
_Avoid_: Departure, session, timeslot

**Response window**:
How long a Provider has to answer an on-request Order, counted only within the Offer's daily response hours and always ending under 4 days after the request.
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
One device's private world inside a Stay, opened by entering the Stay's PIN on that device; a new PIN entry always opens a new, empty Space. It closes at the end of the Stay's checkout day. A Recovery link moves it to another device.
_Avoid_: Session, account, profile

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
The part of a Unit's record a guest may see at a given moment, in the guest's language: no private Host fields, and arrival details and codes only from the release time.
_Avoid_: guest view, public record

**Conversation**:
One Space's ongoing chat with Fetivi: the guest's messages, Fetivi's answers and the notes that tell the model what changed. Each Space has exactly one, read-only once the Space closes.
_Avoid_: chat session, thread

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
