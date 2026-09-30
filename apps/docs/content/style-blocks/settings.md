---
title: Project settings
description: ramonda.css.ts, the rules your project makes stricter than CSS is, and what the class names say.
section: Style blocks
order: 116
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
`ramonda-css`, `ramonda-css format`, the build and your editor all have to read the same
answer, and none of them reads a bundler's config:

```ts alternatives
export default {
  units: { length: ["px", "rem"] },
};
```

`1em` is then reported — not because CSS minds, but because your project does:

> `em` is a length this project does not use. `ramonda.css.ts` allows px, rem.

That file is [its own page](/style-blocks/config): what a project can narrow, and how the three
selectors decide which setting reaches which property.

## The names a block emits

A class name is two halves with a `-` between them: **what the declaration sets**, and **the value as
you wrote it** — spaces written `_`, because a class name cannot hold one.

```
display: inline-flex     r-disp-inline-flex
opacity: .5              r-o-.5
outline-offset: 4px      r-outline_offset-4px
```

**A shorthand is several classes, because it reaches the stylesheet as the longhands it sets:**

```
padding: 12px            r-p- r-pt-12px r-pr-12px r-pb-12px r-pl-12px
padding: 4px 0           r-p- r-pt-4px r-pr-0 r-pb-4px r-pl-0
```

The first one, `r-p-`, has no rule and sets nothing — its value is empty, which is how you can
tell it apart. It tells a merge that a whole `padding` was
written here, so everything `padding` covers is cleared first. That matters for a package built by
an older release, whose classes may not match the ones this release writes.

That is what lets two blocks settle their own conflicts without the stylesheet: no two classes on an
element set the same property, so a `padding-left` written after a `padding` simply replaces it —
see [order](/style-blocks/order#if-you-read-the-output). A shorthand that is not split, like
`background: var(--b)`, keeps its own class — `r-bg-var(--b)`.

About sixty properties have a short spelling — `p`, `m`, `w`, `h`, `bg`, `c`, `gap`, `items`,
`rounded` — and the rest use their own name, which already reads. It is a small list on purpose: a
short form nobody recognises is worse than the property's own name, because it is shorter *and* has
to be learned.

A property's own `-` is written `_`. That is not decoration: the **first** `-` is where the first
half ends and the value begins, and a value holds a `-` all the time — `-4px`, `sans-serif`, `a-b`.

**The value is written exactly as you wrote it, and that is not a nicety.** `opacity: .5` and
`opacity: 5` are both valid CSS, and anything that tidied the `.` away would give them one class —
two rules merged into one, on a page nobody edited.

Where a declaration sits joins the property with a `.`:

```
&:hover { color: red }                    r-:hover.c-red
&::after { width: 10px }                  r-::after.w-10px
& .title { font-weight: 600 }             r-_.title.fw-600
@media print { color: red }               r-@media_print.c-red
```

The `_` before `.title` is the space in `& .title` — which is what separates a descendant from
`&.title`, a different element and a different class.

### Why the first half is always there

**Because it is what a merge reads.** Composing two blocks keeps, per thing set, the one written
later — and a block handed to another component arrives as a class string and nothing else. So what
a class sets has to be readable out of the class itself, or the merge has nothing to decide with.

That is also why no class name is *only* a hash.

## When a half is a hash

Each half falls back on its own, and the other one still reads.

**The value**, when it cannot be written:

```
transition: border-left-width .15s ease-in-out   r-tr-QbofRLj5j
content: "a b"                                   r-content-5dEHlFqj2
```

- **over 32 characters** — in practice a `transition` or a `grid-template` with several parts;
- **a character a class name cannot hold** — a quote, most often.

**The context**, marked by a leading `0`:

```
&:hover, &:focus { color: red }          r-0dG3Pq.c-red
&[data-on] { color: red }                r-0W6pfz.c-red
@media (min-width: 40rem) { gap: 8px }   r-03noXL.gap-8px
```

- **a selector list** — `&:hover, &:focus` is two selectors sharing a body, and there is no one
  spelling for it;
- **a quote**, which markup would have to escape;
- **a `-`**, which is where the first half ends. `[data-on]` and every `@media (min-width: …)` hold
  one, and this is what they cost.

A written name never begins with `0`, because no CSS property may begin with a digit and every
context begins with `:`, `.`, `_`, `@` or `[`. So the `0` says *hashed* and can be nothing else.

## In the stylesheet they look escaped

```css
.r-bg-\#10b981 { background: #10b981 }
```

That backslash is CSS's own: in a selector a `#` starts an id, so a class name holding one has to say
it means a `#`. The markup carries the name without it, which is what you see in devtools and what
you would grep for.

## Next

- **[The config file](/style-blocks/config)** — everything `ramonda.css.ts` holds, and what a
  project can decide not to allow.
- **[What is checked](/style-blocks/checking)** — every rule, and how to switch one off.
- **[Tooling](/style-blocks/tooling)** — formatters, linters, and other JSX libraries.
