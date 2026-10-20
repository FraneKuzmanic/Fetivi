# Fetivi

An AI assistant for guests in short-term accommodation that answers questions about the stay and the destination and arranges local services.

## Hosts and properties

**Host**:
An account that runs one or more Properties and enters the information guests are answered from.
_Avoid_: Owner, landlord, user

**Property**:
A place a Host rents out, at one address and in one time zone, holding the content its Units share.
_Avoid_: Building (except in the physical sense), listing

**Unit**:
One rentable space of a Property. It inherits the Property's content and may override it field by field, or hide or replace the Property's Info blocks.
_Avoid_: Apartment (as the generic term), room, listing

**Info block**:
A titled piece of Markdown guest information in one Guide section, owned by a Property or a Unit, with a revision number that grows with every edit of its title or text.
_Avoid_: Article, note, card

**Translation**:
One guest language's version of an Info block's title and text, for one revision: the host's own text, a machine translation, or the host's correction.

**Published revision**:
The revision of an Info block guests see; it moves forward only when all seven languages exist for a newer revision.

**QR link**:
A Unit's permanent guest link, issued once the admin approves its Property and printed as a QR code.
_Avoid_: Invite link, booking link

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

**Stay**:
One guest party's registered visit to a unit, from check-in to checkout, identified by its PIN.
_Avoid_: Reservation, booking
