---
"@ramonda/check": minor
---

`aria-value` — an `aria-*` attribute carrying a value its specification does not permit.

The third of the ARIA tables, and the one with the most to catch. Its two siblings judge NAMES: is
this a real attribute, is this a real role. Neither has anything to say about `aria-hidden="yes"`,
because the name is perfect.

**The browser keeps it.** An attribute is a string, so a wrong value survives to the inspector
looking exactly as healthy as a right one. What does not happen is the meaning: the element stays in
the accessibility tree, an `aria-live="loud"` region announces nothing, `aria-level="two"` gives a
heading no level at all. Only a screen reader disagrees, and only for the people who need it.

`ARIA_VALUES` is the value type of every state and property that HAS one, written from the
Characteristics table in **WAI-ARIA 1.2** — booleans, the three that also take `undefined`, the two
tristates, the integers, the numbers, and the seven closed token lists.

The types deliberately NOT in it are the ones with nothing to judge. An id reference is any
non-empty name and a label is any string, so every value is well formed and a table entry would only
create the chance of reporting correct markup. An attribute with no entry is one no rule has an
opinion about.

`false` is never reported: `aria-hidden="false"` is the documented way to say an element is exposed,
which is not what leaving the attribute off says. Nor is an expression — `aria-hidden={hidden}` is
not a value this can read, and guessing is what the package refuses.

Zero reports across every app and package here. Proved not silently dead by corrupting a real
`aria-expanded` in the docs' own menu button and watching the CLI name it.

The token wording came from reading the printed report, not the code: the bare list said `it takes
\`assertive\`, \`off\`, \`polite\``, and it says `one of` now.
