---
"@ramonda/css": patch
---

A keyword written in a different case is no longer reported — and no longer makes a second class.

**The class name did not fold case, and that was a live fault.** Measured through the real transform:

```
color: currentColor;   →  r-c-currentColor
color: currentcolor;   →  r-c-currentcolor
```

Two atomic classes with identical CSS, and two hashes with them. `normalise.ts` folded a value's case;
`flatten.ts` built its own canonical text and never called it. One class either way now.

**And the report goes.** `color: currentColor` — the spelling MDN documents — failed the build, and
every rule is an error. The forty `<system-color>` names went with it: `Canvas`, `ButtonFace`,
`AccentColor`, each spelled here exactly as the specification prints them.

`csstype`, the shared type behind emotion, styled-components, vanilla-extract and StyleX, lists
`"currentColor"` outright and ends its colour with `(string & {})` — none of them reports a case at
all.

`ramonda-css format` still rewrites every one of them, asserted through the real biome on a value, a
pseudo-class, an at-rule name and a media feature at once. A difference that is more than case —
`&:before` for `&::before`, `2n + 1` for `2n+1` — is still reported.
