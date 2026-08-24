---
"@ramonda/check": minor
---

Three accessibility rules now report past a spread, because a spread cannot un-write a name

The element family goes quiet on `<img {...rest} />` for a good reason: the spread may CARRY the
`alt` the rule is about, and nothing static can say whether it does. That argument is about an
attribute that is ABSENT, and it was being applied to three rules about attributes that are
plainly written down.

- `unknown-aria-attribute` reads a NAME. `<div {...rest} aria-lablled="Filters" />` is misspelled
  on the tag, and no object spread on either side of it can take a name off.
- `aria-with-no-subject` reads a name on a fixed set of TAGS. A spread cannot turn a `<meta>` into
  something a screen reader exposes.
- `unknown-role` reads a VALUE, so it takes the guard itself and reports only from the side a
  spread cannot reach over: `<div {...rest} role="buton" />` ends up with `buton` because the last
  attribute wins, while `<div role="buton" {...rest} />` may end up with whatever `rest` carries
  and is left alone.

`ElementContext` grows `overwritable(name)` for the third of those — whether a spread is written
after the attribute — so the order question is answered once rather than per rule.

Measured on the six real projects in this repository: no new findings. The silence the guard
exists for is unchanged — `<img {...rest} />` still reports nothing.
