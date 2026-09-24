---
"@ramonda/css": minor
---

**A shorthand now reaches the stylesheet as the longhands it sets**, and the eighteen numbered
cascade layers become one.

```
padding: 12px          r-pt-12px r-pr-12px r-pb-12px r-pl-12px   (was r-p-12px)
border-top: 1px solid red
                       r-border_top_color-red r-border_top_style-solid r-border_top_width-1px
background: red        r-bg-red                                  (unchanged — see below)
```

```css
@layer ramonda.a, ramonda.s64, …, ramonda.s02, ramonda.u, ramonda.c;   /* was u00 … u17, c */
```

**Why.** Two classes on one element could set the same property — a `padding` and a `padding-left` —
and only the stylesheet's order could decide between them. That is what the numbered layers were
for. Split the shorthand and the question disappears: every declaration is a longhand, no two
classes collide, and the merge settles everything by key where you wrote it. A `padding-left` after a
`padding` simply replaces it.

**Which families split.** 42 positional ones, answered by how many values were written, and 19
bag-of-tokens ones answered by what each token IS — the whole `border` family, `outline`,
`column-rule`, `flex-flow`, `list-style`, `text-decoration`. Both tables are measured in Chromium,
Firefox and WebKit and a family is written only where all three agree and it reproduces its own
corpus.

**Which do not, and it is a fact rather than a shortfall.** A grammar with a comma, a slash or a
repetition cannot say which part goes where, so `background`, `font`, `grid`, `animation`,
`transition` and `mask` keep their shorthand. So does any value the compiler cannot vouch for: one
holding a `var()`, a runtime value, an arm of a `match`, or a negative length where the family
refuses one — because CSS drops a whole declaration when any part of it is invalid while a split
would drop only the part.

**The layer names are counts now, not positions.** `ramonda.s10` holds shorthands that set ten
longhands. A position moved every family below it whenever CSS gained a property, so two stylesheets
built a year apart disagreed about which layer `padding` was in; a count is a fact about the
property and does not move. That is what makes a published package safe to drop into an application,
and `scripts/check-layer-skew.mjs` holds it: the real compiler, the real sheet and the real merge, in
all three engines and both load orders.

**If you wrote CSS against these class names, it will need updating** — a rule targeting `.r-p-12px`
has four classes to match now. Nothing else changes: the same declarations reach the page, and
`@layer ramonda` is still the name to put in your own statement.
