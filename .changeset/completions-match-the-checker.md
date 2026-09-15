---
"@ramonda/css": patch
---

The editor stops offering what the checker refuses, and the useful names come first.

**A kind taken only from variables no longer offers its literals.** With
`"<color>": { variablesOnly: true }`, typing `color: ` offered all 210 colour keywords — every one
of which `literal-not-allowed` then refuses. `currentcolor` and the CSS-wide keywords stay, because
the setting leaves those alone too.

**A vendor-prefixed name sorts last.** `&::` offered eight `-moz-` and `-ms-` pseudo-elements ahead
of `before`, because the list was alphabetical and a dash sorts before a letter.
