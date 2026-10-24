# Recorded drafting pages

Pages and one API response the catalog drafting tests run on (ticket 42), fetched once on **2026-10-24 at about 10:50 UTC**. The page-text, fetch, pipeline and job tests read these files and never reach the network.

| File | Fetched from | What it holds |
| --- | --- | --- |
| `konoba-venue.html` | `https://www.svdominik.com/` | Restoran Sv. Dominik's homepage. The same venue is in `../../seeding/recorded/` (OSM `website` and Overture `websites`), so a candidate built from those rows drafts from these pages. Nav links to Contact, About us and Menu; address and phone in the footer; no JSON-LD. |
| `konoba-contact.html` | `https://www.svdominik.com/contact/` | The contact page: address, phone, the reservations e-mail, and opening hours ("Monday – Saturday 3:00pm – 23:00pm, Sunday closed"). |
| `tourist-board-place.html` | `https://www.visittrogir.hr/en/tourist/attractions/kamerlengo-fortress` | A Trogir Tourist Board page with one schema.org JSON-LD block and little text (the hours are in an image). |
| `injection-venue.html` | hand-written | A made-up venue page with prompt-injection text: a hidden instruction to set the phone to +1 900 …, a script, an HTML comment posing as a system message, and text that tries to close the `<page>` tag. |
| `commons-imageinfo.json` | `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url\|extmetadata&iiurlwidth=1280&format=json&formatversion=2&titles=File:Fortress_Kamerlengo_14.jpg` | The imageinfo of `File:Fortress Kamerlengo 14.jpg` (the image `catalog/seed/trogir.ts` uses): CC BY-SA 4.0, by Krzysztof Bergier. Its `thumburl` is on `thumb.wikimedia.org`; the original `url` is on `upload.wikimedia.org`. As served. |

The three HTML pages are trimmed for size only: styles, `<link>` and `<meta>` tags (except the description), external scripts, SVGs, `<noscript>` and presentational attributes (`class`, `style`, `data-*` …) are removed, one small inline script is kept so script stripping is exercised, and JSON-LD blocks are kept. Personal data is removed: the homepage's testimonial carousel (reviewers' and staff names) is cut out. Only the business's public details remain. Biome skips these files (`biome.json`), since they are third-party markup.

## Re-recording

The one-off script lives untracked in `.scratch/build/record-drafting-42.ts`. Run it from the repo root with `node --import tsx .scratch/build/record-drafting-42.ts`. It fetches the four URLs above with the agent `Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)` (Wikimedia's User-Agent policy asks for one) and trims the pages as described. Then check the pages for personal data, update the date above, and the expected values in `page-text.test.ts`, `fetch-pages.test.ts` and `commons.test.ts`.

## Licences

- The venue and tourist-board pages are quoted for tests only; their content belongs to their publishers.
- Commons metadata (the API response) is CC0. The image it describes is CC BY-SA 4.0, Krzysztof Bergier.
