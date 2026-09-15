---
"@ramonda/css": patch
---

Two places that wrote without looking at what was there.

**A placeholder that came back twice** left this package's own marker in the author's file. `restore`
refused a placeholder the formatter had eaten and not one it had duplicated — the first got its block
and the second kept `/*@ramonda-css:0*/ 0`. Refused now, for the reason the missing case already
gave: there is no correct output to fall back to, so there is no output.

**Codegen overwrote a hand-written `ramonda.css.generated.ts`** and said nothing. That loss is
unrecoverable — the name is in `.gitignore` by this package's own instruction, so there is no copy.
A file at that name which does not carry `@ramonda/css` is kept, and the run stops with what to do
about it. Looked for loosely, so a file written by an older version is still ours.
