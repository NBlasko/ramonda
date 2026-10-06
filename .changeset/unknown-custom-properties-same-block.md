---
"@ramonda/css": minor
---

**`unknownCustomProperties: "same-block"` allows a made-up name as a local.** One block may set a
name and read it — `--gap: 4px; padding: var(--gap);` — and nothing else may: a read the block does
not set is refused, and so is a setting it does not read. A `style` attribute counts as one block.
