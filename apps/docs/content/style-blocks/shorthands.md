---
title: Shorthands
description: A shorthand reaches the stylesheet as the longhands it sets, so the later one wins as in CSS. What stays whole, what is refused, and what it costs.
section: Style blocks
order: 113
---

# Shorthands

A shorthand is a property that sets several others at once: `padding` sets `padding-top`,
`padding-right`, `padding-bottom` and `padding-left`. Those four are its **longhands**.

A block writes a shorthand into the stylesheet **as its longhands**, each one a class of its own:

```tsx
const card = <div className={@@( padding: 12px; )}>…</div>;
```

```html
<div class="r-p- r-pt-12px r-pr-12px r-pb-12px r-pl-12px">…</div>
```

The first class, `r-p-`, has an empty value and no rule. It marks that a whole `padding` was written
here, so composing this block with another clears everything `padding` covers first. The other four
are ordinary rules, one per side.

## Later wins, as in CSS

Because a shorthand arrives as its longhands, a longhand written after it replaces just that side,
and a shorthand written after a longhand replaces it:

```tsx
const a = @@( padding: 8px; padding-left: 40px; );    /* 8px, and 40px on the left */
const b = @@( padding-left: 40px; padding: 8px; );    /* 8px on every side */
```

That is what the same two lines do in a stylesheet. It holds across blocks too — a
[spread](/style-blocks/composing) and `mergeClassNames` keep, per side, the one written later — and
across the logical spellings: `margin` covers `margin-inline` and `margin-block-start` as well as
`margin-left`.

A CSS-wide keyword on its own splits like any value: `padding: inherit` is four longhands, each
`inherit`.

## What stays whole

A few shorthands reach the stylesheet as written, in one class, because splitting them would change
what the page does:

| written | why it is not split |
|---|---|
| `border: var(--b)`, `border: 1px solid $color.line` | what a `var()` holds is known only when the page computes it, so which longhand gets which part is unknown — and a [`$` variable](/style-blocks/variables) is a `var()` |
| `font: caption` | a system font stands for values the browser fills in itself |
| `text-box: cap`, `text-wrap: pretty` | one browser drops the whole declaration, and a split would still apply the rest there |
| `all: unset` | it covers every property there is |

A whole shorthand still loses to a longhand written after it, and still clears a longhand written
before it — the same answer as a split one. [Which declaration wins](/style-blocks/order#if-you-read-the-output)
shows the layers that give that answer.

### Two whole shorthands

The one case the layers cannot settle is a **narrower whole shorthand after a wider one**:

```tsx expect-report:narrower-after-a-whole-shorthand
const box = @@(
  border: var(--frame, 1px solid #ccc);
  border-top: var(--edge, 0);
);
```

Both reach the stylesheet whole and sit in the same layer, so no order keeps `border-top` winning on
every page. It is refused; set the longhands of the second one instead — `border-top-width`,
`border-top-style`, `border-top-color`.

The check follows a spread, a `mergeClassNames` call and a `$` variable across blocks and files. What
it cannot see — a block chosen at run time — the merge warns about in development.

## What is refused

Three shorthands, or values of one, render differently from one browser to the next, so a block does
not write them:

| written | reported as | write instead |
|---|---|---|
| `-webkit-mask: …` | `resets-differ-across-engines` — browsers reset different longhands for it | `mask` |
| `animation: auto` | `value-differs-across-engines` — one browser reads `auto` as a name, the others as nothing | the longhands you mean |
| `place-self: left anchor-center` | `word-out-of-its-longhand` — `align-self` has no `left`, so the browser drops the whole line | a value both longhands take |

## What it costs

More classes on an element. `padding: 12px` is five where it would have been one, and a `background`
is ten. The stylesheet stays small, because each of those rules is shared by every element that sets
the same side to the same value.

A project that would rather not write shorthands at all can switch them off in
[`ramonda.css.ts`](/style-blocks/config#shorthand-switching-a-shorthand-off) — then a shorthand is
reported, with the longhands to write.

## Next

- **[Which declaration wins](/style-blocks/order)** — conditions, breakpoints, and the layers under
  all of this.
- **[Composing, and who wins](/style-blocks/composing)** — spreading one block into another, and
  merging them side by side.
