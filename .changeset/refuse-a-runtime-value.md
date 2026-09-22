---
"@ramonda/css": minor
---

**The hole is gone.** A runtime value in a declaration is refused, everywhere.

```
color: {this.brand};             ✗  hole-not-allowed
```

It cost something on every element, and it could not be shared. Measured, the same colour written
two ways: `color: red` emits `r-c-red { color:red; }` and the element carries a class, while
`color: {this.brand}` emitted `color:var(--r-…-0)` with the value written on every instance — a list
of ten thousand rows was ten thousand style attributes. And a hole belonged to the declaration it
stood in, so two declarations wanting one value got two custom properties.

Two things replaced it, and the message names both:

- **`match`**, for a value that is one of a few. Every arm is its own rule and its own class, so the
  subject picks between classes that already exist in the stylesheet.
- **`@@property`**, for a value that really comes from data. One declared name, read by as many
  declarations as want it, set once on the element.

**The braces are untouched where they choose rather than inject.** `if ({…})` and `...{…}` merge
whole groups, `match({…})` picks between classes, and `var({name})` names a `@@property` site the
compiler resolves before the CSS is written.

What went with it:

- **`properties: { "*": { holes: false } }`** — the per-project setting. There is nothing left to
  switch off, and nothing to switch back on.
- **`StaticCssBlock`** — the per-prop spelling of the same refusal, and `CssBlock`'s second type
  parameter with it. `CssBlock<Allow>` is the only block type now.
- **The second block helper** the virtual file used to declare, since every block is static.

**Every block is hoisted now.** There used to be two paths — a block with no hole was hoisted to
module scope, one with a hole was built at the site — and the second is gone. Measured, that is the
return: merging at a site allocates per element per render, 0.86 µs against 0.001 µs for reading a
hoisted one.
