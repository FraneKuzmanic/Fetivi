# 0004: A unit goes live through the go-live check; the QR slug is issued then

**Status:** accepted, 2026-10-21 (ticket 20)

## Context

Until now a unit got its permanent QR slug the moment its property was approved, and a new unit under an approved property got one at once. Nothing checked that the unit had an address, times, access instructions, Wi-Fi, a host phone or published translations, so a guest could scan a QR code and land on an empty guide. The PRD (§6.6) asks for a minimum to go live, and the setup wizard needs a place to enforce it.

The guest link (`findUnitBySlug`, `enterPin`) and Stay registration (`assertUnitLive`) already key on the slug.

## Decision

- "Live" means "has its QR slug". The slug is issued only by the go-live check (`goLiveUnit`), which requires an approved property and the go-live minimum: address, check-in time, check-in method and access instructions, checkout time, Wi-Fi or "no Wi-Fi", host phone, and every effective Info block's current revision published (04's `translationsDone` rule, now the pure `allBlocksPublished`).
- The host goes live from the wizard or the unit page (`POST /api/host/units/:id/go-live`). Approving a property runs the check for each of its units and issues slugs to the ones that already meet the minimum. A unit created under an approved property starts without a slug.
- Live is one-way. A host who later clears a required field keeps the unit live; the wizard shows a warning instead. Guests mid-stay never lose access because of a host edit, and slugs stay permanent.
- No new column: the gates are unchanged and now mean "approved and the minimum met".

## Consequences

- A host cannot print a QR code before the unit is live. That is acceptable: the code is useless before then.
- The QR download of a unit that is not live answers `409 unit-not-live`; going live answers `409 not-approved` or `409 not-ready`.
- Existing units that already have slugs stay live. Test fixtures that seed `qrSlug` directly stay valid.
- The minimum is one pure function (`goLiveCheck`) shared by the server and, if needed, the browser.
