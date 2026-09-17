---
title: A declaration that does nothing
description: Valid CSS the browser ignores, because another declaration on the same element switched it off — reported where you wrote it, and why nothing else can see it.
section: Style blocks
order: 109
---

# A declaration that does nothing

Some CSS is wrong in a way nothing complains about. The property exists, the value is valid, every
tool is happy, and the browser ignores the line:

```css
display: block;
gap: 12px;      /* a block container has no tracks, so nothing is spaced */
```

Nothing throws. The build is green. The layout is a little wrong, and the line that looks like the
fix is already there.

## Your editor says so, on the line

```tsx expect-report:declaration-does-nothing
const row = @@(
  display: block;
  gap: 12px;
);
```

> `gap` does nothing here: `display: block` lays out no children of its own, so there is nothing for
> it to arrange.
>
> Write `display: flex` or `display: grid`, or take the declaration out.

## Why this question is answerable here

A stylesheet does not know which of its rules reach an element. Three files can each contribute a
declaration to one `<div>`, and no one of them knows about the others — so nothing in ordinary CSS
can say *this line does nothing*, and no tool built on ordinary CSS offers it.

A block is **one element's rule**. Every declaration in it lands on the same element, which is what
makes the pair above a question with an answer.

## Why a test does not catch it either

`getComputedStyle` reports the **computed** value, not what the browser did with it. On an element
written `position: static; z-index: 10`, a browser answers `z-index: 10` and stacks nothing. On
`display: inline; width: 300px` it answers `300px` and lays the element out at its content width.

So a test that asserts computed styles agrees with you about a declaration the page ignored. What
the browser did is only visible in geometry — which is a screenshot, or an assertion about pixels,
in a real browser, for a layout you would have to think to go and check.

## What is reported

Each row is one declaration switched off by another **on the same element**:

| written | what happens |
|---|---|
| `gap`, `row-gap`, `column-gap` beside a `display` that arranges no children | there are no tracks to space |
| `justify-content`, `align-items` beside the same | there is nothing to align |
| `flex-direction`, `flex-wrap`, `flex-flow` beside the same | there is no flex line |
| `grid-template-columns`, `grid-template-rows`, `grid-auto-flow`, `grid-auto-columns`, `grid-auto-rows` beside the same | there is no grid |
| `top`, `right`, `bottom`, `left` and the `inset` properties beside `position: static` | a static element does not move |
| `float` beside `position: absolute` or `fixed` | the element left the flow the float needed |
| `resize` beside `overflow: visible` | only a scroll container can be resized |
| `text-overflow: ellipsis` beside a `white-space` that wraps | no line ever overflows |
| `text-overflow: ellipsis` beside `overflow: visible` | the text spills instead of being cut |
| `aspect-ratio` beside a `width` and a `height` that are both plain lengths | the box already has both sizes |

**A `display` that arranges children** is `flex`, `grid`, `inline-flex`, `inline-grid`, the
two-value `block flex` and `inline grid`, and the `-webkit-` spellings of all of them — including
`-webkit-box`, which is old flexbox and does use `gap`.

**The `inset` properties** are `inset`, `inset-block`, `inset-inline`, `inset-block-start`,
`inset-block-end`, `inset-inline-start` and `inset-inline-end`.

Three rows have an exception, and each of them is real CSS:

- **`gap` in a multi-column block.** `display: block; columns: 2; gap: 12px` spaces the columns, so
  it stays quiet.
- **`resize` and the ellipsis beside an `overflow` longhand.** `overflow: visible; overflow-x: auto`
  is a scroll container after all, so both come back and neither is reported.
- **`aspect-ratio` beside a size that is not one yet.** A `height` of `50%`, `min-content`,
  `fit-content` or `stretch` is not a size until something has been laid out, so the ratio still
  applies. Only two plain lengths — `140px` and `4rem` — mean the box really has both.

Some properties that look like they belong here are missing on purpose. `align-content`,
`justify-items`, `place-items` and `place-content` all work on a block container in current
browsers, so none of them is a fault.

## What stays silent, and why

**A declaration on its own says nothing.** A block can be composed, and what a
[spread](/style-blocks/composing) brings is not visible from the block reading it:

```tsx
const positioned = @@(
  position: relative;
);

const badge = @@(
  ...{positioned};
  top: 4px;      /* quiet: `positioned` is what makes this work */
);
```

So the check reads a disabling declaration only where one is **written**. `top: 4px` with no
`position` beside it is left alone.

**An inherited property is silent too.** `white-space` comes down from an ancestor, so
`overflow: hidden; text-overflow: ellipsis` with no `white-space` of its own may be exactly right.
It is reported only when the block writes a `white-space` that wraps.

**A nested rule is its own group.** `&:hover` is the same element, and `& > span` is a different
one. One reading has to serve both, so a declaration is decided only by the declarations beside it:

```tsx
const card = @@(
  display: block;
  &:hover { gap: 12px; }   /* quiet, though the hover is the same element */
);
```

**And a hole is unanswerable.** `display: {this.mode}` could be anything, so nothing beside it is
judged.

## Switching it off

Like every rule, by id in [`ramonda.css.ts`](/style-blocks/settings):

```ts
export default {
  rules: { "declaration-does-nothing": "off" },
};
```

For one line rather than the whole project, [the ignore
directive](/style-blocks/checking#when-a-rule-is-wrong) takes a reason and covers the next line
only.

## Next

- **[What is checked](/style-blocks/checking)** — every other fault a block can carry, and the one
  way to say a rule is wrong about your line.
- **[Which declaration wins](/style-blocks/order)** — the other question a single element's rule
  can answer: an override the stylesheet's order will not honour.
