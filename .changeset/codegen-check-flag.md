---
"@ramonda/css": minor
---

`ramonda-css codegen --check` reports a stale `css-system/` instead of writing it.

The generated pair is committed, so something has to say when it stops matching the config beside
it — the same question this repository already answers for `keywords.generated.ts`. Codegen knows
both halves already, because it compares each file before writing for an unrelated reason, so
`--check` writes nothing, names the files that no longer match, and exits non-zero.
