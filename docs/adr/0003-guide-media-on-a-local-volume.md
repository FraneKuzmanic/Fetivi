# 0003: Guide media live on a local volume, and their captions are translated with the block

**Status:** accepted, 2026-10-21 (ticket 19)

## Context

Hosts attach photos and short videos to Info blocks so guests can follow how-tos (washer, AC, lockbox) without messaging them. The architecture lists media on `InfoBlock` but left storage open. Fetivi runs on one VPS (§4.1). Every caption is also the media's alt text, so a guest must read it in their language, and guests must never see an item before the text that explains it is published in all seven languages (§4.3).

## Decision

- Files are stored on a local directory (`MEDIA_DIR`, a volume shared by the back-office API and the chat backend) behind a small `MediaStore` interface (`put`, `remove`), as `<media id>.<ext>`. An object store can implement the same interface later.
- Uploads are JPEG, PNG or WebP up to 10 MB and MP4 or WebM up to 50 MB, checked by file signature, at most six per block, each with a caption of up to 200 characters. Files are served as uploaded: no transcoding, resizing or thumbnails.
- Adding an item or changing its caption is a new block revision. The translate-block job translates the captions in a second call with the same frozen prompt, one bullet per caption, so the structure check keeps them aligned; a language is written only when both calls produced it. Each `block_translations` row carries a `captions` map. An item carries the revision that added it, and guests see it once that revision is published. Removing an item is not a new revision.
- Guests fetch a file through `GET /api/media/:id` on the chat backend, which serves it only when the id is in the Space's guest projection at that moment. Tenancy, publication and the arrival release follow from that one rule. Byte ranges are answered, which iOS Safari needs to play video.

## Consequences

- Production needs the volume mounted in both containers and included in backups (ticket 47).
- A crash between writing a file and committing its row leaves an orphan file. Explicit deletes remove files; a retention sweep catches the rest (ticket 45).
- A block with media costs one more model call per translation.
- Host corrections in the Translations panel do not edit captions yet. A correction keeps the machine captions; a correction row for a language that had none shows the source caption.
- Each media request builds the guest projection. Browser caching (`private, max-age=86400`) keeps repeats off the server.
- Moving to an object store changes the `MediaStore` implementation and the two serving routes only.
