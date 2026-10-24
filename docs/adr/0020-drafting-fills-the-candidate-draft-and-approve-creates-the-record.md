# 0020: Drafting fills the candidate's draft, and Approve creates the record

**Status:** accepted, 2026-10-24 (ticket 42)

## Context

ADR 0019 left the creation of a Catalog record from a Seeding candidate to ticket 42: a ticked candidate waits in the curation queue as a `draft` item with `payload.candidateId` and no record. The candidate's name and coordinates are open data, and OpenStreetMap's are ODbL. Venue websites, socials and tourist-board pages are untrusted text. Drafting calls `claude-haiku-5-5`, whose spend comes from the monthly API credit. Verified records go stale each season, and the admin cannot re-check about 200 venue sites by hand.

## Decision

- **The drafting job fills the existing draft item** (`payload.changes`, `place`, `images`, `drafting`). It does not enqueue a new item, so there is still one item per candidate under the dedupe key `seeding-candidate:<id>`. Approve or Edit of a drafted candidate draft creates the record, writes its hours, seasons and image, links the candidate's open-data rows to it (`record_id` set, `candidate_id` cleared), deletes the candidate, and Approve stamps `verified_at` (ADR 0017's apply-then-verify flow). A draft that is not drafted stays Reject-only and `invalid-input` on Approve.
- **Only the venue's own pages are sources.** The URLs come from the candidate's open-data rows (OSM `website`, `contact:*`, `url`, `facebook`, `instagram`; Overture `websites`, `socials`), or for a refresh from the record's website, `field_sources` and attached rows. A URL is kept only when it is a venue site, a Facebook or Instagram page, or a page under a `FALLBACK_SITES` tourist-board host. There is no web search. Each task fetches through its own `createEgress({ allowlist })` built from those hosts and their `www.` twins, so a redirect off them is blocked. The jobs process's static allowlist gains only `commons.wikimedia.org`.
- **Every drafted field cites a fetched page.** The title, description, address, phone, website, opening hours and seasons are kept only when the model's `sourceUrl` is one of the pages actually fetched. The value goes to `changes` and the URL to `changes.fieldSources`. Page text is cut per page and per task, stripped of markup and scripts, and wrapped in `<page>` tags that the system prompt says are data. Output is validated again before it is stored. A draft with no cited title is `no_sources`. When a page says the place closed for good, the model cites that page too, and the description starts with "Permanently closed according to <url>." naming it; a drafted description keeps its own source.
- **Location by licence precedence.** The record's point comes from the candidate's rows in the order bathing_water, overture, osm. An OSM-derived point is recorded in `field_sources.location` as the OSM URL. One point per place, combined with independently curated content, is the Collective Database reading of ODbL, and the guest map already credits "© OpenStreetMap contributors". The category is the candidate's mapped category (CATEGORY_PRECEDENCE), which can come from a different row than the location, so the draft records each one's own row URL. Approve adds `placeCategory` and `location` to `field_sources` from those (none for an Overture row, which has no URL).
- **Images only from Wikimedia Commons**, when the candidate's OSM `wikimedia_commons` or `image` tag names a Commons file, read through the Commons API with its licence, attribution and page URL. Never from venue sites or socials. Without one, guests see the category illustration.
- **Refresh compares factual fields only:** the title (folded), address, phone, website, opening hours and seasons. A field the pages do not mention is not a diff. Descriptions and images are never re-drafted. Each changed record becomes one `refresh_diff` item with `previous`, under the dedupe key `refresh:<recordId>:<runId>`. A record with an open diff, or refreshed in the last 30 days, is skipped. A failed refresh does not count toward those 30 days, so the next run retries it.
- **A run takes at most 25 records** (`DRAFTING_LIMITS.recordsPerRun`). A run is one admin action: a tick sent to drafting, "Draft waiting" or "Start refresh". The rest wait and are shown as a count, and the next run the admin starts takes them. "Draft waiting" retries failed drafts, not `no_sources` ones. The cap is a constant.
- **No pg-boss retry.** The jobs have `retryLimit: 0`, because the SDK already retries transient API errors and a job retry would spend credit twice. A task still queued 30 minutes after it was created has lost its job, so the next run marks it failed and it no longer blocks drafting or refresh.

## Rejected

- A web search for sources: an extra paid API, and an egress wider than the place's own sites.
- Re-drafting descriptions on refresh: a freshly written text differs every time, so every record would become a diff.
- Images from venue sites or socials: Fetivi has no permission to use them.
- A global budget ledger: not asked for. The per-run cap and the per-task page and character limits bound the spend.
- Creating the record when drafting finishes: it would publish unreviewed text to guests once translated (ADR 0019).

## Consequences

- A candidate without a website or social page stays `no_sources`. The admin rejects it or adds the record by hand.
- An Approve that crashes between creating the record and linking the rows can leave an unlinked record. This is the same accepted edge as ADR 0017.
- The draft item's `payload.candidateId` dangles once the candidate is deleted. The queue shows the record's title from then on.
