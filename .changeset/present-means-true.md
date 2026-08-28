---
"@ramonda/check": minor
---

A boolean attribute is read as PRESENT, not as what its string says

`truth` had one answer for two kinds of attribute. An `aria-*` is an enumerated string where
`"false"` is a real value; an HTML boolean attribute is on whenever it is written down, whatever
is on it. `required="false"` is a required field.

That is not a reading of the spec, it is what this framework does: `core/Attribute.ts` removes an
attribute for the VALUE `false` and keeps the STRING `"false"`, because removing it is the only
way to turn `disabled` off — and its own comment names `aria-` as the exception for exactly this
reason. The checker now mirrors that instead of running a second rule beside it, reading
`BOOLEAN_ATTRIBUTES` from `@ramonda/dom-facts`, which is where that list was put so a second copy
would not be made.

Three rules were wrong on one line of markup, each measured with a plant:

- `<main hidden="false">` was counted as a second visible landmark by `more-than-one-main`. It is
  hidden, so there is one.
- `<video muted="false">` was asked by `media-with-no-captions` for captions it has no sound to
  need.
- `<input required="false" aria-required="false">` — the exact contradiction
  `aria-that-contradicts-the-tag` exists to report — was reported by nothing.

Two reports against correct markup, and one real fault nobody was naming. `required={false}` is
unchanged and stays silent: written that way the attribute never reaches the element, so there is
nothing on it to contradict.
