---
title: Names the stylesheet sees
description: Custom properties with names TypeScript checks, keyframes and font faces as blocks of their own, and why a theme is var() and not a hole.
section: Style blocks
order: 109
---

# Names the stylesheet sees

A block is **one element's rule**. Anything that names something for the whole stylesheet is not
that — and written inside a block it compiles, nests inside the class rule, and does nothing at all.
`@keyframes slide { … }` becomes `.r-…{@keyframes slide{…}}`, which no browser resolves.

```
@media (min-width: 40rem) { … }     ✓  a condition on this element's rule
@supports (display: grid) { … }     ✓
@container (min-width: 20rem) { … } ✓
@keyframes slide { … }              ✗  reported
@font-face { … }                    ✗  reported
@property --brand { … }             ✗  reported
```

The last three get a block of their own, with the at-rule written into the opening:

```tsx
const slide = @@keyframes(
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
);

const card = @@(
  animation: {slide} 240ms ease-out;
);
```

**The rule goes to the stylesheet and the site becomes its name.** The name is a hash, because a
whole `@keyframes` has no short spelling the way one declaration does — so the same animation written
in two files is one rule.

`slide` is then an ordinary binding, and that is what makes the reference checkable: a typo is an
unresolved identifier, and TypeScript reports it with its own *did you mean*. Written in a stylesheet
instead, the name would be a string on both sides and `animation: slidein` would be one typo away
from silence.

A reference resolves **when the file compiles**, not on the element, so `{slide}` costs no custom
property. It has to: `var()` takes a literal name, and a reference that stayed a hole would compile
to `var(var(--…))`, which resolves to nothing.

## A variable with a name TypeScript checks

A named `@@property` block is a binding like any other, so a variable is declared once, typed, and
read wherever it is imported:

```tsx
export const accent = @@property(
  syntax: "<color>";
  inherits: true;
  initial-value: #10b981;
);

const card = @@(
  {accent}: #f05;
  background: var({accent});
);
```

A misspelling is not a CSS problem here, it is an unresolved name: `var({ackcent})` is *Cannot find
name 'ackcent'. Did you mean 'accent'?*, from TypeScript, with the suggestion it already knows how to
make.

**A theme is a module of these.** Put the tokens in their own file and import them — there is no
`@@theme`, because a file of `@@property` sites already is one.

## A name nothing sets

A plain `var(--name)` is checked against every name the whole build sets — not only the block it is
written in, so a parent setting what a child reads needs no ceremony:

```tsx
const table = @@( --row-height: 32px; );
const row = @@( height: var(--row-height); );
```

A name nothing sets is reported, with the four things that would make it exist:

> nothing in this build sets `--brnad`. Did you mean `--brand`?
> Set it in a block, register it with `@@property`, add it to `variables` in `ramonda.css.ts` if it
> comes from a stylesheet this does not compile, or give it a fallback — `var(--brnad, <value>)` —
> which says it may be absent.

A fallback is the answer most of the time, and it is CSS you would write anyway.

## Theming

**A theme is custom properties, and a block reads them.** Nothing here is a theme system, which is
the same position [styling](/styling) takes: the theme lives in an ordinary stylesheet, and switching
it is one attribute on `<html>` — no render, no JavaScript per element, and the block does not know a
theme exists.

```css
:root                  { --accent: #10b981; --surface: #ffffff; }
[data-theme="dark"]    { --accent: #34d399; --surface: #0b0b0b; }
```

```tsx
const card = @@(
  background: var(--surface);
  border-left: 4px solid var(--accent);

  @media (prefers-color-scheme: dark) {
    border-left-color: var(--accent, #34d399);
  }
);
```

### A hole is not a theme

It is tempting, because a hole and a `var()` are the same thing underneath — a hole compiles to
`var(--r-<hash>-0)` and the element carries the value. The difference is **who sets it**, and it
decides the cost.

Measured on a server render of 500 rows with one themed value: through a hole the markup went from
19.4 KB to **39.9 KB** — 41 bytes on every element, for one themed value. Through `var()` it is
nothing, because the value is on `:root` and each element inherits it.

And a theme switch through a hole is a **render**. A hole's value belongs to the render that produced
it, so every element carrying it has to render again to change it. A `var()` changes when the
attribute on `<html>` changes, which is not a render at all.

A hole is for what varies per **instance** — a value this element has and the one beside it does not.
A theme is the opposite of that.

## Next

- **[Composing](/style-blocks/composing)** — reusing a block, conditions, and which declaration wins.
- **[Project settings](/style-blocks/settings)** — telling the checker about names that come from a
  stylesheet it does not compile.
