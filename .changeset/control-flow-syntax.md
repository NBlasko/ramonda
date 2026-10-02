---
"@ramonda/css": minor
---

**Breaking: a block's logic has a new spelling, and the old one is refused.** Each old form is
refused with an error that names its replacement.

- **Code goes into a block as `$( … )`**, wherever it stands: `...$(base)`, `var($(width))`,
  `$(angle): 45deg`, and every condition and subject below. `{ … }` is CSS's own again.
- **A theme variable is `$group.path`** — `$color.primary.main`, the group right after the `$` (it
  was `$.color.primary.main`). In code, the generated `css-system` exports one name per group:
  `import { $color, $space } from "./css-system"`, so a variable is spelled the same in a block and
  in TypeScript. There is no `$` export any more, and a group's name must be an identifier.
- **A condition is `when $( … ) { … }`**, and it gains `else when $( … ) { … }` and `else { … }`.
  The first condition that holds brings its group.
- **`match $( … ) { … }` works at both levels**: `color: match $(t) { a => red; _ => blue; };` picks a
  value, and `match $(t) { a => ( color: red; padding: 4px; ); }` picks a whole group.
- **A value may be a choice**: `border: $(error) ? 2px solid red : 1px solid #ccc;`, and choices
  chain. Both values become classes; the condition picks one.
- The formatter writes `} else {` on one line, lines match arms up on their `=>`, lays a chain of
  choices out as a table, and takes parens off a branch.
- `var(--color-accent)` written by hand for a variable the project declares is reported
  (`variable-by-hand`), naming `$color.accent`. A `$` naming a group the project does not have says
  which groups it has.
- The checker now reads the value in every match arm and every branch of a choice, which it did not
  before: `color: match $(t) { a => redd; }` is reported like `color: redd`.
- **What the build refuses, the editor now shows**, in the build's own words (`block-refused`):
  an `else` out of place, `when $(a) $(b)`, a condition inside a match arm, a choice with no `:`.
  It cannot be switched off, and neither can `block-in-a-template`, since the build refuses both.
- **The Prettier plugin lays out a block's inside** as `ramonda-css format` does — it used to hand
  the CSS back as written — and the editor's hover explains `else`, `else when` and `match` too.
- **`glued-hole` is gone.** It fired only beside `hole-not-allowed`, about a value that is refused
  anyway, and its advice led to that same refusal. A `rules` entry naming it is now refused as not a
  rule; take it out.
- A condition holding operators — `when $(p ? q : r)` — compiled to the wrong expression. It is one
  condition now.

Update the VS Code extension to 0.3.0 with it: the colours follow the new spelling.
