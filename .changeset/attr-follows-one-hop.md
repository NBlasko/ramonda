---
"@ramonda/check": patch
---

The accessibility family reads a value that was declared elsewhere.

`element.ts`'s `attr` read a string literal and nothing else, and **every element rule reads through
it** — so `role={ROLE}` where `const ROLE = "button"` was invisible to forty rules at once. Measured
with `fixtures/one-hop`: `unknown-role`, `positive-tabindex` and `link-without-a-destination` all
reported the literal and went silent one hop away. `numberAttr` had the same hole for `tabIndex` and
`aria-level`, and `lossyIn` had it for `@persist cache = makeCache()`.

**A branch and a call are deliberately not followed here**, which is the opposite of what the
fault-finding rules want. `alt={ok ? "" : "a cat"}` has no single answer, and taking the first arm
would report an element that is right half the time. `fresh-object-in-props` follows both, because
there ANY path that builds is the whole fault. The shared walk now takes both as parameters.

`arrow-fields` was on the same list and is not a gap: it reports a function LITERAL in a field and
leaves a field initialised from a call alone on purpose, because `debounce(this.save, 200)` is
legitimate and a walk that followed the call would report the arrow inside `debounce`. That decision
now has a test, so it is not undone by someone working down the list.

No new findings in `apps/docs`, the three playgrounds, or `router`, `query` and `form`.
