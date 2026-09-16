---
title: Which declaration wins
description: Two declarations of one property, and the rule that decides between them — the more specific case wins, whatever order you wrote it in.
section: Style blocks
order: 110
---

# Which declaration wins

Two declarations of the same property, and both apply. Plain CSS answers with whichever was written
last. A block answers with a rule, and it is the one every atomic CSS framework arrived at: **the
more specific case wins, whatever order you wrote it in.**

## The four things that decide it

In this order:

```
1  a condition beats no condition          padding: 8px          then  @media … { padding: 40px }
2  a longhand beats its shorthand          padding: 8px          then  padding-left: 40px
3  a narrower max-width beats a wider one  max-width: 64rem      then  max-width: 40rem
4  a wider min-width beats a narrower one  min-width: 40rem      then  min-width: 64rem
5  a standard property beats its prefix    -webkit-box-shadow    then  box-shadow
```

So this does what you meant, and the order you wrote the two breakpoints in does not matter:

```tsx
const card = <div css={@@(
  padding: 8px;
  @media (min-width: 40rem) { padding: 16px; }
  @media (min-width: 64rem) { padding: 24px; }
)}>…</div>;
```

At 70rem the element gets `24px`. Not because that line is last, but because `64rem` is the narrower
case — write the three in any order and the answer is the same.

**Write them out of order and you are told.** A declaration that cannot override the one above it is
refused rather than quietly ignored:

> `padding` is written to override `@media (min-width: 64rem)` above it, and it will not — the
> stylesheet emits the rule that applies to a wider viewport first, so the earlier one wins wherever
> both apply. Write it above, or put it under the same condition.

## A prefix is a fallback, so it goes first

`-webkit-box-shadow` and `box-shadow` are the **same property** to the engine, so one of them has to
be written first and the other wins. The sheet always puts the prefixed one first, which is what a
prefixed fallback means and is the order you would write by hand:

```tsx
const card = @@(
  -webkit-box-shadow: 0 0 1px #0003;
  box-shadow: 0 0 9px #0003;
);
```

Written the other way round it is refused, because the sheet cannot give that order:

> `-webkit-box-shadow` is written to override `box-shadow` above it, and it will not — the
> stylesheet emits a vendor prefix before the standard property it is another name for, so the
> earlier one wins wherever both apply.

You rarely need one. This stylesheet is built on `@layer`, and every engine that has cascade layers
already has the unprefixed `transform`, `box-shadow`, `user-select` and `appearance`.

## Two conditions that can both be true

A stylesheet has one position for each rule, and two conditions that may hold at the same time each
want a different one. There is no order to give them, so it is refused:

```tsx expect-report:override-out-of-order
const card = @@(
  @supports (display: grid) { color: red; }
  @supports (display: flex) { color: blue; }
);
```

> `@supports (display: grid)` and `@supports (display: flex)` can both hold at once, and the
> stylesheet cannot be ordered for both — it has one position for each rule, and whichever the
> build reads first would win.

Conditions that **exclude** each other are fine, and they are most of what anybody writes — a colour
scheme, an orientation, a medium. No element is ever matched by both, so nothing has to be ordered:

```tsx
const card = @@(
  @media (prefers-color-scheme: light) { color: #111; }
  @media (prefers-color-scheme: dark) { color: #eee; }
);
```

## A mode is not a size

`prefers-color-scheme` and `@media print` are weaker than a breakpoint; `@supports`, `orientation`,
`prefers-contrast` and `forced-colors` are stronger. So a theme goes above the breakpoints that
refine it:

```tsx
const card = <div css={@@(
  @media (prefers-color-scheme: dark) { color: white; }
  @media (min-width: 64rem) { color: black; }
)}>…</div>;
```

The full order, weakest first:

```
prefers-reduced-motion  →  prefers-color-scheme  →  print  →  BREAKPOINTS
   →  @supports  →  orientation  →  prefers-contrast  →  forced-colors
```

**Breakpoints sit in the middle**, so a breakpoint beats a dark-mode rule and `forced-colors` beats a
breakpoint. That is Tailwind's order, and the reason to keep it is which mistake stays quiet: theming
usually lives in the block you reuse, and the block reusing it usually adjusts at a breakpoint.

A condition this list does not name — `@media (min-height: …)`, `@media (hover: hover)`, a width in
a unit that cannot be turned into a number — comes last. Two of those against each other is the one
case with no rule: nothing tells them apart, so the one you wrote last wins. Put them under one
condition if it matters.

## Reusing a block does not change any of it

`...{base}` merges another block's declarations. Two declarations of one property under different
conditions are two different things set, so both survive the merge and the list above decides:

```tsx
const base = @@( @media (prefers-color-scheme: dark) { color: white; } );

const card = <div css={@@(
  ...{base};
  @media (min-width: 40rem) { color: blue; }
)}>…</div>;
```

At 40rem and up the element is blue, in dark mode too — the breakpoint is further down the list.

**Write it the other way round and you are told, at run time in development:**

```
[@ramonda/css] `color` is composed later under `@media (prefers-color-scheme: dark)` than under
`@media (min-width: 40rem)`, and it will not override it — the stylesheet emits the stronger
condition last, so the earlier one wins wherever both apply. Put the two under one condition, or
compose them the other way round.
```

Inside one block that is a build error instead, on the line you wrote. Across a reuse it can only be
a run-time warning: what is in `...{base}` is a value, and the compiler does not know it. It is said
once, and it is not in a production build at all.

## The one place the stylesheet decides instead of you

Everything above is decided where you wrote it. There is one exception, it is reported rather than
silent, and it is worth understanding once.

A stylesheet has **one** order, and a rule in it is shared by every element that names it — so it
cannot follow any single block's order. It emits unconditional rules before conditional ones, which
is what makes the ordinary shape right:

```tsx
const card = @@(
  padding: 8px;
  @media (min-width: 40rem) { padding: 24px; }   /* wins on a wide screen, as you would expect */
);
```

And it is why the opposite cannot compile: a block that puts the conditional declaration first is
asking the sheet for an order it has no way to give, so it is refused with the sentence above rather
than emitted and quietly wrong.

## If you read the output

You will see numbered layers inside `ramonda`:

```css
@layer ramonda.u00, …, ramonda.u17, ramonda.c;
@layer ramonda {
  @layer u09 { .r-p-8px { padding: 8px; } }
  @layer c { … @media (min-width: 40rem) { … } … }
}
```

That is the list above, made into cascade layers — a layer's place is decided by that statement
rather than by where its rules sit, which is what keeps the order the same however the files load.

You never write against these names. **`ramonda` is the name to put in your own `@layer` statement**,
and it orders everything inside it — see [composing](/style-blocks/composing#the-one-place-this-is-not-plain-css).

## Next

- **[Composing](/style-blocks/composing)** — merging blocks, conditions, and your own stylesheet.
- **[What is checked](/style-blocks/checking)** — every rule, including the two above.
