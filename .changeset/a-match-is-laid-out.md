---
"@ramonda/css": patch
---

`ramonda-css format` lays out a `match`, which it used to leave as it found it.

```
color: match({this.tone}) {quiet => $.color.accent.quiet;
  loud  => $.color.text.primary;};
```

comes back as

```
color: match({this.tone}) {
  quiet => $.color.accent.quiet;
  loud  => $.color.text.primary;
};
```

A match is a third shape beside a declaration and a nested rule, and it was laid out as neither:
`opensAHole` asks whether the text in front of a `{` is a declaration's head, and `color:` is — so
the brace that opens a match body was read as a hole and every arm was swallowed as one run of text
nothing was allowed to touch.

The arms line up on their `=>`, because a match is a lookup table and a table reads aligned. The
padding is the longest key's, so an arm with a longer key than any before it moves the others — the
ordinary cost of alignment, and the reason it is worth it here is that the keys are a closed set.

The `;` that ends the declaration rides the closing brace, because that is what it ends.
