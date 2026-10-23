# 0017: Curation Approve applies the proposal first, then verifies

**Status:** accepted, 2026-10-23 (ticket 39)

## Context

A draft or refresh diff proposes field values for a Catalog record, and a host's place suggestion proposes a new record. Approving one must write those values and stamp the record's `verified_at`. The admin often wants to adjust the text first, and the catalog record editor already exists.

`createCatalogRecord` and `updateCatalogRecord` open their own transactions, because the translation job is enqueued inside them. The queue has no assignees, so two admins can act on one item at once.

## Decision

- Approve writes the proposal through the catalog store first. Then, in a second transaction, it moves the item to `approved` with a conditional update (`where status in ('open', 'needs_visit')`) and calls `markVerified`. If the conditional update matches no row, another admin won, and the loser gets `not-reviewable` (409).
- `curation_items.applied_at` records that the proposal was written. Approve and Edit skip the write once it is set.
- Edit applies the proposal (or creates the suggested place, unverified), sets `applied_at` and opens the existing record editor. The admin then edits the live record and approves from the queue. That Approve only verifies and keeps the admin's edits.

## Rejected

- Threading a transaction through the catalog store: it would change signatures that many callers use, only to make a rare race atomic.
- A second editor inside the queue: it would duplicate the record editor's validation and its translation handling.

## Consequences

- Two admins approving at the same moment can both write the same values. That is harmless: equal text bumps no revision, and only one status update succeeds.
- If a concurrent Edit wins on a host place suggestion, the loser's new record stays as an unverified orphan. This is accepted as a rare edge case.
- `applied_at` stays null on an approve that wrote nothing (a guest flag, a Provider suggestion or a cluster).
- A draft or refresh diff must carry a `recordId`. Without one, Approve and Edit return `invalid-input` and the item stays open, so a proposal is never closed unwritten. A source URL in `changes.fieldSources` is kept only for a field the record's kind has.
