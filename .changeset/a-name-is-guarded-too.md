---
"@ramonda/css": patch
---

**`toStyle` now checks the NAME as well as the value.** A token beginning with `--` was returned
verbatim, so a name carrying a `;` became two declarations on a server-rendered page — the hazard
the value's guard already existed for, arriving through the other door.

Measured end to end: rendered with `renderToString`, then read back through the browser's own parser
on those bytes.

| written | declarations that applied |
|---|---|
| `;` in the value | none — the setting is dropped, as before |
| `;` in the name, before | `--brand: red`, `--evil: red` |
| `;` in the name, now | refused |

It is reachable only past the types, which is the threat model the value's guard is written for in
the same file: *a cast, an `any`, a JavaScript caller, data off an API*. The name had no such belt,
though `nameOf`'s other branch — `var(--…)` — already threw for a token this package did not write.
A malformed name now throws the same way, because it is the same thing: not data that turned out
wrong, but a name nothing here ever wrote.

The alphabet is CSS's own ident and it was measured rather than guessed: every custom property in a
real build of both apps in this repository is `--` followed by `[A-Za-z0-9_-]`.

Two things this measurement found to be already safe, and they are worth stating: a `"` in a value
is escaped to `&quot;` by the serializer, and a `<script>` in one does not become an element.
