# @ramonda/dom-facts

## 0.1.0

### Minor Changes

- 0c6c61b: New rule: `misspelled-element-property` — a name one capital away from working

  A few pieces of element state live in a PROPERTY and have no attribute of that name at all: an
  `<input>`'s `indeterminate`, and a media element's `volume`, `playbackRate` and `currentTime`.
  There is no `playbackrate` content attribute for `playbackRate` to be the lowercase form OF, so
  each has exactly one spelling and anything else is a different name.

  `putAttribute` matches the table exactly for that reason, and the consequence is silent:
  `playbackrate={2}` matches nothing, falls through, and is written into the document as an attribute.
  Nothing reads it, the video plays at normal speed, and the line looks right.

  **The types accept both.** `RamondaArgs` has an arm keyed on `Lowercase<string>` so any real
  lowercase HTML attribute passes without being enumerated — `playbackRate` typechecks because the
  element's DOM properties are another arm, and `playbackrate` typechecks because it is lowercase.
  That is what makes this worth a rule rather than a note: it is the RIGHT name in the wrong case,
  written by somebody who reasonably expected HTML's usual indifference to it.

  `@ramonda/dom-facts` gains `propertyOnlyNames(tag)` beside the existing `keptInAProperty`. Core
  needs to know whether ONE spelling is the property; the checker needs the names themselves to say
  what was meant, and a checker with its own copy of them is the second list that table exists to
  prevent. Its note hands this half over by name.
