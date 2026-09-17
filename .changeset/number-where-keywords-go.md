---
"@ramonda/css": minor
---

A number written where only keywords go is reported.

`display: 1` compiled in silence while `position: 1` was caught — and both take no number. What
separated them was whether the generator could reduce their grammar to a primitive, which is not a
fact about CSS.

So the fact is measured instead. `scripts/build-numberless-properties.mjs` launches Chromium,
Firefox and WebKit and asks `CSS.supports(property, n)` for seven different numbers; a property
every engine refuses all of them for is one no number belongs in — 241 of the 566 unprefixed
properties. It is the INTERSECTION rather than the union, because this says a number is *wrong*.

Only when the number is the whole value: `box-shadow: 0 0 1px red` and `transform: scale(2)` are
correct CSS on properties in that list, and both are measured to be accepted.
