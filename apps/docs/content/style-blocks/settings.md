---
title: Project settings
description: ramonda.css.ts, the rules your project makes stricter than CSS is, and what the class names say.
section: Style blocks
order: 112
---

# Project settings

Most of this package has no settings, on purpose. A class name is a hash of what the block does, and
two projects that named one block differently would emit two rules for the same thing with nothing to
notice. So identity is fixed, and the rest is not.

## Two places, because they have different audiences

**How the build writes its output** belongs to the bundler plugin, which already knows whether this
is a production build:

```ts alternatives
export default defineConfig(({ mode }) => ({
  plugins: [ramondaCss({ runtime: "@ramonda/css" })],
}));
```

**Rules your project agrees on** belong in a `ramonda.css.ts` beside your `tsconfig.json` — because
`ramonda-css lint`, `ramonda-css format` and your editor all have to read the same answer, and none
of them reads a bundler's config:

```ts alternatives
export default {
  // Every unit CSS has is fine unless you say otherwise.
  units: ["px", "rem", "%"],
  rules: { "unknown-unit": "off" },
};
```

`1em` is then reported — not because CSS minds, but because your project does:

> `em` is a CSS unit this project does not use. `ramonda.css.ts` allows %, px, rem.

`rules` takes a rule's id from [the table](/style-blocks/checking#every-rule), and a typo in one is
caught: writing `unknown-unti` tells you so and names the one you meant.

## The names a block emits

A class name says what its rule does. It is `r-`, a short spelling of the property, a `-`, and the
**value as you wrote it** — spaces written `_`, because a class name cannot hold one.

```
padding: 12px            r-p-12px
display: inline-flex     r-disp-inline-flex
opacity: .5              r-o-.5
padding: 4px 0           r-p-4px_0
outline-offset: 4px      r-outline-offset-4px
```

About sixty properties have a short spelling — `p`, `m`, `w`, `h`, `bg`, `c`, `gap`, `items`,
`rounded` — and the rest use their own name, which already reads. It is a small list on purpose: a
short form nobody recognises is worse than the property's own name, because it is shorter *and* has
to be learned.

**The value is written exactly as you wrote it, and that is not a nicety.** `opacity: .5` and
`opacity: 5` are both valid CSS, and anything that tidied the `.` away would give them one class —
two rules merged into one, on a page nobody edited.

Where a declaration sits is written in front of it:

```
&:hover { color: red }                    r-:hover-c-red
&::after { width: 10px }                  r-::after-w-10px
& .title { font-weight: 600 }             r-_.title-fw-600
@media print { color: red }               r-@media_print-c-red
```

The `_` before `.title` is the space in `& .title` — which is what separates a descendant from
`&.title`, a different element and a different class.

## Why some are still a hash

```
r-QbofRLj5j
```

Four reasons, and each is a name that could not be written rather than a preference:

- **the declaration carries a hole** — its value is a custom property, not text you wrote;
- **the name would be too long** — over 32 characters, which in practice means a `transition` or a
  `grid-template` with several parts;
- **the value or the context holds a character a class name cannot** — a quote, most often;
- **the selector is a list** — `&:hover, &:focus` is two selectors sharing a body, and there is no
  one spelling for it.

## In the stylesheet they look escaped

```css
.r-bg-\#10b981 { background: #10b981 }
```

That backslash is CSS's own: in a selector a `#` starts an id, so a class name holding one has to say
it means a `#`. The markup carries the name without it, which is what you see in devtools and what
you would grep for.

## Next

- **[What is checked](/style-blocks/checking)** — every rule you can switch off here.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, and other JSX libraries.
