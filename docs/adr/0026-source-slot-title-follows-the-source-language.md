# 0026: The source slot's title follows the source language

**Status:** accepted, 2026-10-28 (ticket 56)

## Context

The translation job stored a block's own title and text unchanged in the slot of the language it detected (the source slot). The setup wizard pre-fills a prompt's title from its copy in the back office's interface language, so a host using the back office in English and writing in Croatian got English titles ("How to find us", "Hot water") in the Croatian slot. Croatian guests saw English headings over Croatian text; every other language got both translated.

## Decision

- **The model reports the title's language.** The structured output gains `title_language` (same list as `source_language`). For the source language the model returns the text unchanged, and the title unchanged when it is already in that language, otherwise translated into it.
- **Code decides what is stored.** `sourceTitleOf` in `translation/collect.ts` keeps the model's source-slot title only when `title_language` differs from the source language and the title keeps its links and placeholders; otherwise the host's own title is stored. The text in the source slot is always the host's own.
- **The same rule for every item with its own title:** Info blocks, named host places, offers and catalog records. Field texts store no title, and a host pick's stored name stays empty.
- **Existing blocks are fixed by a one-off command,** `pnpm --filter @fetivi/jobs blocks:retitle` (`retitleBlocks`). It selects published wizard blocks whose source slot still holds `info_blocks.title`, calls the model once per block, and updates only the source row's title at the published revision, then emits the projection event. No revision bump, no status change, nothing hidden; a fixed block is not selected again, so a rerun costs nothing.

## Rejected

- A separate title-only model call: a bare title gives the model nothing to compare with, and it doubles the calls.
- Changing the wizard's default titles to the guest language: the host's back-office language says nothing about the language they write in.
- Re-queueing translation for existing blocks: the job finds all seven languages present and skips the model; bumping the revision could hide published blocks.

## Consequences

- The frozen system prompt changed once, so the prompt cache resets once.
- The source slot's title may differ from `info_blocks.title`. The back office keeps showing the host's own title.
- Host corrections are never touched: they cannot target the source slot, and machine rows keep their insert rules.
