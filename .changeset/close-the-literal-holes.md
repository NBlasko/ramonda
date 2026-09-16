---
"@ramonda/css": patch
---

Two ways a literal still reached the page under `variablesOnly` are closed.

**A colour longhand did not reach the build.** `color: red` was left to the types, and vite and
esbuild run the rules without type-checking a block — so the checker refused it and the dev server
served it. Forty properties. The rule reads them now, and the compiler's duplicate is dropped.

**A custom property set in a block was an open door.** `--own: red; color: var(--own)` walked around
the setting in one line.

A custom property has no kind, so only a value that can be nothing else is reported — a hex, a colour
function, a named colour, or a number carrying a unit. `--n: 3`, `--label: "red"`, `--own: var(--x)`
and `--gap: 0` stay silent.
