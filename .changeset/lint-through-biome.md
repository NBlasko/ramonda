---
"@ramonda/css": minor
---

**`ramonda-css lint` runs through biome in a project whose linter is biome.** It took only oxlint,
so a project that chose biome for both halves — `create-ramonda`'s Biome add-on — could format its
files with blocks and not lint them: `biome lint .` stops at the first `@@(`. It is oxlint when the
project has an `.oxlintrc.json` or no biome, and biome otherwise, with the project's own rules and
every position mapped home as before. A biome that fails, or prints a report this cannot read, is a
failure — never a file that lints clean.
