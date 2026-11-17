# 0031: A guest sees the active, published Offers of their host and of their Destination's Providers; booking re-checks it

**Status:** accepted, 2026-11-17 (ticket 69)

## Context

The thesis supervisor asked that the code and the thesis state precisely which Providers and Offers a guest's assistant can see and offer. The rule already lived mostly in one place (`visibleOfferCondition`), but it was not written down as a whole: the language filter and the result order sat in the readers, the "active and published" check was repeated by hand in two other places, and the booking re-checks were spread over the `create_order` halves and the order machine. The readers are the MCP `services` tools (`list_offers`, `check_availability`, `create_order`), plan items and the `search_places` bookable boost.

## Decision

- **Who is asking.** The guest token gives the Stay's property, the property's Destination (none when the property has no location or lies outside every Destination) and the Space language.
- **The rule.** An Offer is visible to the guest when all of these hold:
  1. Active: the Offer is switched on.
  2. Published: it has a published revision, which exists only once all seven guest languages do.
  3. In the guest's language: the published revision has a translation in the guest's language; the guest reads that text.
  4. Owner: either the host's own service (any of the host's properties, inside or outside a Destination), or, only when the property is inside a Destination, a Provider Offer of that Destination
  5. whose Provider is active (the admin's switch; a Provider exists only once the admin has a deal), and
  6. which the property's host has not hidden.
- **The guest's own filters.** `list_offers` can narrow by category and by place; a place id that is not a valid id returns nothing.
- **Order.** By translated title, then by Offer id. The order never uses commission, the owner or distance.
- **Never considered.** Commission, deal notes, the guest's dates, distance.
- **The same rule everywhere.** `list_offers`, `check_availability`, both halves of `create_order`, plan items and the `search_places` boost all read Offers through `visibleOfferCondition`. The boost returns only Offer ids, so it skips the translation join (filter 3); a published Offer has all seven languages, so the result is the same. An Offer outside the rule is answered `not permitted`, the same answer as an unknown id, so the tools never confirm that it exists.
- **Bookability comes after visibility.** `check_availability` and the first half of `create_order` then check that the date is inside the Stay and not past, the party size is 1 to 999, the availability mode books in chat (allotment and on request; live does not), a pay-online Offer has a merchant that accepts cards, and a start is still ahead with room for the party. The first half also needs a single start or a chosen one.
- **Re-check on the tap.** The second half of `create_order` does not trust the stored draft: it re-reads the Offer with the guest's current scope, and an Offer unpublished, switched off, whose Provider was switched off or hidden in between releases the record and books nothing. The order machine then re-checks the Offer is active, pay-online support, payments and capacity under a row lock.

## Rejected

- Hiding Offers that cannot be booked in chat (live mode, pay-online without a ready merchant) from `list_offers`: the guest can still learn about the service and get its details; `check_availability` tells the assistant to share them instead.
- Ordering by commission or putting the host's own services first: the assistant recommends, and Fetivi must not steer by its cut.
- Filtering by the guest's dates when listing: dates are a `check_availability` question, and a list without dates stays stable through the conversation.

## Consequences

- Changing a filter means changing `packages/domain/src/offers/visibility.ts` and this ADR. Two related checks share filters 1 and 2 through `activePublishedOffer`: whether the `services` tools are listed outside a Destination (`situation/load.ts`, the host has an own Offer a guest could see) and the host's list of Providers their guests may see (`listHostProviders`, which also lists hidden ones, marked hidden).
- Existing Orders are outside the rule: `list_my_orders`, `cancel_order` and `respond_to_order_update` read by Space, so a guest can always see and cancel what they booked.
- Inside a Destination the `services` tools are listed even when the rule leaves no Offer; `list_offers` then returns an empty list.
