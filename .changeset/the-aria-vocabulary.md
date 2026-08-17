---
"@ramonda/check": minor
---

Three rules over the ARIA vocabulary.

`unknown-aria-attribute` — an `aria-*` attribute the specification does not have, and it names the one that was
meant when that is certain. The fault worth catching is not the invented name but the CASE:
`aria-labelledBy` looks right, is a different attribute from `aria-labelledby`, and does nothing at
all. `unknown-role` — a `role` that is not one, told apart from an ABSTRACT role, which is somebody
reading the spec's inheritance diagram and taking a branch for a leaf. `aria-with-no-subject` — `role`
or `aria-*` on an element with no accessibility tree node to describe, where the attribute does not
do a little, it does nothing.

The vocabulary ships as data in `src/rules/aria.ts`, from WAI-ARIA 1.2 with the 1.3 role additions,
and *ARIA in HTML* for the element table. The tables lean LONG on purpose: short by a name they
would report correct markup, which is the one kind of mistake this package treats as fatal to its
own usefulness.

All three are warnings and all three are quiet across this repository. Checked by changing one real
`aria-label` to `aria-Label` in the docs app and watching the report name it, with the fix.
