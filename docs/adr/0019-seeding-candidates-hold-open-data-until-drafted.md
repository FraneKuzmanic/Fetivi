# 0019: Seeding candidates hold open data until they are drafted

**Status:** accepted, 2026-10-24 (ticket 41)

## Context

Seeding imports a Destination's places from OpenStreetMap, the EEA bathing-water list and Overture Maps. OpenStreetMap is ODbL, a share-alike licence, so its fields must stay apart from the curated columns of `catalog_records` (architecture §4.2, §6). A Catalog record reaches guests as soon as its translation sets `published_revision`, whatever its verification. ADR 0017 requires a draft Curation item to carry a `recordId`, and the drafting job that writes the draft text is ticket 42.

## Decision

- Every imported row lives in `place_open_data_sources`, unique per `(destination_id, source, external_id)`, with its source, licence and fetch time. It links to a Seeding candidate (`candidate_id`) or to an existing Catalog record (`record_id`), never both, or to neither until it is grouped.
- `seeding_candidates` holds state only: its status and who ticked it. Its name, location and category are read from its rows by source precedence.
- Ticking a candidate enqueues one `draft` Curation item with `payload.candidateId`, no `recordId`, and the dedupe key `seeding-candidate:<id>`. No Catalog record is created.
- Such a draft offers only Reject until ticket 42 drafts it. Ticket 42's Approve creates the record.

## Rejected

- Creating the record at tick: it would publish placeholder or open-data text to guests within minutes of its translation.
- Storing the name and location on the candidate: it would copy open data out of its own table, which is the separation AC 3 asks for.

## Consequences

- Approve and Edit of a draft not yet drafted stay `invalid-input` (ADR 0017 unchanged).
- Deleting a Catalog record sets its rows' `record_id` to null; the next import's grouping gives them a new candidate.
- Ticket 42 must link the candidate's rows to the new record on Approve: set `record_id` and clear `candidate_id`.
