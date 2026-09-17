---
"@ramonda/css": minor
---

A declaration another declaration on the same element switches off is reported.

`display: block; gap: 12px` is valid CSS. Every tool is happy, the build is green, and the browser
spaces nothing. So is `position: static; top: 20px`, and `text-overflow: ellipsis` beside a
`white-space` that wraps — ten rows in all, each one a layout that is quietly a little wrong with
the line that looks like the fix already in place.

A stylesheet cannot ask this. It does not know which of its rules reach an element, so nothing built
on ordinary CSS can say *this line does nothing*. A block is one element's rule, which is what makes
it answerable here.

A test does not catch it either. `getComputedStyle` reports the computed value rather than what the
browser did: it answers `z-index: 10` on a static element and `width: 300px` on an inline one,
having done neither.

Every list in the rule was measured against Chromium rather than recalled, and that removed four
properties from it — `align-content`, `justify-items`, `place-items` and `place-content` all work on
a block container in current browsers, and reporting them would have reported correct CSS. `gap`
keeps its multi-column exception for the same reason.

Silence is the default wherever the answer is not certain. A `...{spread}` merges declarations the
reading block cannot see, so a disabling declaration counts only where it is written; `white-space`
is inherited, so an absent one is never assumed; a nested rule is judged on its own declarations;
and a hole is not judged at all.

Switch it off with `rules: { "declaration-does-nothing": "off" }`, or for one line with a
`ramonda-css-ignore` and a reason.
