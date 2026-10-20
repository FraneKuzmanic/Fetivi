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
A titled piece of Markdown guest information in one Guide section, owned by a Property or a Unit, with a revision number that grows with every edit.
_Avoid_: Article, note, card

**QR link**:
A Unit's permanent guest link, issued once the admin approves its Property and printed as a QR code.
_Avoid_: Invite link, booking link

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
