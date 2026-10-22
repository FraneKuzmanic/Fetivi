# Recorded Jadrolinija feed

The safety-alert tests run on these files and never reach the network. Jadrolinija's RSS feed is read in production only when `JADROLINIJA_RSS_ENABLED=true`, which stays off until Jadrolinija gives written permission to poll it (PRD §9).

| File | What it holds |
| --- | --- |
| `jadrolinija-vijesti.xml` | `https://www.jadrolinija.hr/feeds/vijesti`, fetched once by hand on **2026-10-22 at 21:24:53 UTC** (23:24 in Zagreb), byte for byte as served. One item: "Svi Jadrolinijini brodovi plove prema redu plovidbe" (all ships sail to timetable), naming no line. |
| `jadrolinija-vijesti-suspension.xml` | **Reconstructed, not served.** The same RSS envelope with the 2026-10-14 "Linije u prekidu, 15.10.2026" item, built from the quote in `.scratch/research/ferry-cancellations.md` §1 (title, link, pubDate and the line 9603 sentence). Its guid `urn:uuid:81` is made up. |

Feed traits the parser relies on (seen in the recording): RSS 2.0 with the Atom namespace as `a10`, `Cache-Control: no-store`, a single item, the body in `description` and/or `a10:content`, and a `pubDate` whose "Z" is really Croatian local time.

## Re-recording

```bash
cd packages/domain/src/alerts/recorded
curl -s -A "Fetivi/0.1 (+https://github.com/FraneKuzmanic/Fetivi)" https://www.jadrolinija.hr/feeds/vijesti -o jadrolinija-vijesti.xml
```

One fetch by hand is not polling. Then update the date above and the expected values in `jadrolinija.test.ts`.
