---
"@ramonda/check": minor
---

New rule: `false-on-a-boolean-attribute` — the word that turns it on

A boolean attribute is true whenever it is PRESENT. The parser never reads the value, so
`disabled="false"` puts `disabled` in the document and the control cannot be used — the opposite of
what the line says, and of what whoever wrote it meant.

The fix is the boolean itself: `disabled={false}` removes the attribute, and removing it is the only
way HTML has of turning one off.

**The static twin of RMD029.** `@ramonda/core` reports this while it runs, and only for markup that
renders; this is the same fault found in a branch nobody has opened. Both read
`BOOLEAN_ATTRIBUTES` from `@ramonda/dom-facts` — put there so a second copy would not be made — so
they cannot come to disagree about which names are boolean.

Three spellings reach the element identically and all three are reported: written out, written in
braces, and held one NAME away in a `const`. Silent on the fix (`disabled={false}` and
`required={condition}` both remove the attribute), on `"true"`, on a spread that may replace the
value, and on the two kinds of attribute this is NOT about — an `aria-*` is an enumerated string
where `"false"` is a real value, and a `data-*` is data something reads back.
