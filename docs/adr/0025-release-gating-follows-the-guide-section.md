# 0025: Release gating follows the Guide section

**Status:** accepted, 2026-10-28 (ticket 52)

## Context

Hosts chose each Info block's visibility: "Always visible" or "From arrival release". The setup wizard defaulted the arrival directions prompt to the release and every other prompt to always visible, the house manual import used the same rule, and a host could change it in the block editor. The choice added a decision hosts did not need to make, and it let arrival details go out early or ordinary information wait.

## Decision

- **The Guide section decides.** `blockVisibilityOf(category)` in `property/vocabulary.ts` is the one rule: blocks in Arrival and access (`arrival_access`) wait for the arrival release, every other section is always visible.
- **The column stays, as a stored derived value.** `saveBlock`, the one block write path, sets `info_blocks.visibility` from the category on insert and on every category change. No API body accepts `visibility`. The projection and every guest read stay unchanged.
- **A data migration rewrites old rows** (`0054_block_visibility_from_section.sql`).
- **Typed secrets stay gated by their fields.** Access instructions, door, building and lockbox codes, the Wi-Fi password, the host phone and the emergency contact phone are held back before the release by the projection, whatever section shows them. Arrival and access is the only section whose block text is gated: it was the only wizard prompt ever gated by default, and secrets belong in the typed fields, which the secret warnings already tell hosts.

## Rejected

- Dropping the column and computing gating from the category in the projection: it touches the projection and every reader, and the migration would carry no data to test.
- A Postgres generated column: the rule would live in SQL, while the back office and the fixtures also need it in TypeScript.

## Consequences

- Blocks hosts had set to "From arrival release" in other sections become visible before the release; arrival blocks a host had set to always visible now wait for it.
- `arrivalDetailsHeldBack` keeps its meaning: it is true only when something is really held back (ticket 49).
- The back office still shows "From arrival release" on a guide entry, read from the derived column.
