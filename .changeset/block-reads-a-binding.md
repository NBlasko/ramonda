---
"@ramonda/css": patch
---

**A binding a block reads through `$( … )` is no longer called unused.** A reference to a
`@@keyframes` or `@@property` site is resolved at build time to the site's generated name, and the
file the linter and the editor read held that name and nothing else — so `const spin = @@keyframes(…)`
read only as `animation: $(spin) …` was reported unused by oxlint and biome, and a rename in the
editor did not reach the use. It is read there now, at the author's own position.
