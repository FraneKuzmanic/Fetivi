# 0018: A host-added place becomes a pick of its record on approval

**Status:** accepted, 2026-10-24 (ticket 40)

## Context

A Host can add a place that is not in the catalog. Its guests see it at once, and it goes on the curation queue as a host place suggestion. When the admin approves (or edits) the suggestion, `createFromSuggestion` creates a new Catalog record with the same name, category and location. Without a link, the guests would then see the place twice: the host-added card and the catalog record. The host's note, which is why the guests should go, would only be on the first.

The new record starts unpublished. Its translation job publishes it later, and a guest must not lose the place in between.

## Decision

- The `host_place_suggestion` payload carries the `hostPlaceId`. `createFromSuggestion` sets that host place's `catalog_record_id` to the new record, inside the approve's apply step (ADR 0017). It only links a row that has no record yet, and a deleted host place is a no-op.
- The guest read prefers the record. Once the record is published and visible in the guest's destination, the row reads as a Host pick of it, with the host's note. Until then, the host-added card stays. So guests see exactly one card, with no gap.
- A Reject keeps the host-only card. Nothing else changes.
- `host_places.catalog_record_id` cascades on delete. If the admin deletes the record, the linked host place goes with it.
- The curation item is a snapshot taken when the place is added (`dedupeKey: host-place:<id>`). Later edits by the host do not change it.

## Rejected

- Host-added places as `catalog_records` rows with a host owner: every catalog query, the admin catalog, the Staleness queue and the Recommendation count would need a host filter, and hosts would own rows in the admin's catalog.
- Deleting the host place on approve: the guests would lose the place until the record publishes, and the host's note would be lost.

## Consequences

- One `host_places` table holds both picks and host-added places. A row created as a host-added place keeps its name, so the host page lists it under "Places you added", marked "In Fetivi's catalog".
- A promoted row counts toward the 20-place limit, as before.
- Deleting the record removes the host's note with it. The record holds the same place, so this is accepted.
