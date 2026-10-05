---
title: Names the stylesheet sees
description: Variables declared in ramonda.css.ts and read with $, keyframes and font faces as blocks of their own, and why a theme lives on :root.
section: Style blocks
order: 110
---

# Names the stylesheet sees

A block is **one element's rule**. Anything that names something for the whole stylesheet is not
that: inside a block it would nest inside the element's class rule, as `.r-…{@keyframes slide{…}}`,
which no browser resolves. So it is reported:

```
@media (min-width: 40rem) { … }     ✓  a condition on this element's rule
@supports (display: grid) { … }     ✓
@container (min-width: 20rem) { … } ✓
@keyframes slide { … }              ✗  reported
@font-face { … }                    ✗  reported
@property --brand { … }             ✗  reported
```

The last three have somewhere else to go, and a variable has two.

## A variable your project declares

Declare it in `ramonda.css.ts` and read it the way it is declared — a group's name starts with `$`:

```ts
// ramonda.css.ts
import { kind } from "@ramonda/css/config";

export default {
  variables: {
    $color: kind("color", { accent: "#10b981", surface: "#ffffff" }),
    $space: kind("length", { gutter: "16px" }),
  },
};
```

```tsx
const card = @@(
  background: $color.surface;
  border-left: 4px solid $color.accent;
  padding: $space.gutter;
);
```

`$color.accent` compiles to `var(--color-accent)`. The name is the path, so the stylesheet is
readable, and the path is the only spelling — there is no string to get wrong.

**The group is `$color` everywhere**: in the config, in a block, and in the `import { $color }` code
uses. A group written without its `$` — `color: kind(…)` — is refused by the config's type and when
the config loads. The `$` is not part of the CSS name: `--color-accent`, not `--$color-accent`.

`$` and a name is only ever a variable. A group the project does not have — `$props.size` — is
reported with the groups it does have, because the usual cause is reaching for a value from code,
which is written `$( … )`.

### Where a group needs importing, and where it does not

A block is CSS, not TypeScript, and the compiler puts every group in scope while it checks one. So
**anywhere in a block you write a variable bare**, with no import anywhere in the file — in a value,
in a `match` arm, in either branch of a choice:

```tsx
declare const dark: boolean;

const card = @@(
  color: $(dark) ? $color.accent : $color.surface;
);
```

**Inside `$( … )` it is ordinary TypeScript**, because that is what the escape holds. TypeScript
resolves a name there the way it resolves every other name — and so it does in the rest of your
file: a lookup table of values, an argument you pass around, a `toStyle` call. There, import the
group by the name it has in a block:

```tsx
import { read } from "@ramonda/css";
import { $color } from "../css-system";

declare const dark: boolean;

const tone = dark ? $color.accent : $color.surface;
const now = read(tone, document.body);
```

The rule is one line: **inside the CSS, no import; in code, import the group.** `$color.accent` is
the same text in both places. Setting a variable from code with `toStyle` takes one more thing — a
[range](#a-range-when-the-value-is-meant-to-move) saying what it may become.

**`css-system/` is written by the compiler**, and it is where the groups come from. Run
`npx ramonda-css codegen` once, or let the build plugin do it; either way the folder holds
`index.ts` (one export per group — `$color`, `$space` — and this project's types) and `variables.css` (the values). Import the
stylesheet once, wherever your app's CSS goes:

```ts
import "../css-system/variables.css";
```

Commit that folder. It is generated, and it is also what your editor reads to check a block, so a
fresh clone that has not built anything yet still gets the checking.

## What `kind` buys, and it is not only spelling

The kind is what the checker knows the variable IS, and it works in two directions.

**A variable of the wrong kind is refused where it is used**, before anything runs:

```tsx expect-error
const wrong = @@(
  padding-left: $color.accent;
);
```

> Type `Token<"color", Fixed<"#10b981">>` is not assignable to type
> `Narrowed<never, CssDimension<…> | Token<"length" | "percentage" | "length-percentage">>`

**And the browser holds the same line.** `codegen` writes an `@property` registration for every
variable, so the kind is declared to the engine too:

```css
@property --color-accent {
  syntax: "<color>";
  inherits: true;
  initial-value: #10b981;
}
```

A registered custom property set to something that is not of its syntax falls back to
`initial-value` instead of poisoning the declaration that reads it. An **unregistered** `--size` set
to `not-a-length` and read by `height` lays the element out at `0px`, silently. Registered, the same
value is ignored, `height` gets the `16px` the registration declares, and the page keeps working.

## A range, when the value is meant to move

A variable declared with one value says it never changes, and the checker holds you to that. When a
theme moves it at run time, say what it may become:

```ts
export default {
  variables: {
    $color: kind("color", {
      accent: { value: "#10b981", range: "any" },
    }),
    $space: kind("length", {
      gutter: { value: "16px", range: ["8px", "16px", "24px"] },
    }),
  },
};
```

`value` is the initial value — what the registration carries and what the browser falls back to.
`range` is what the TYPE permits: `"any"` for a value only the run time knows, or the closed list
when there are three sizes and no fourth.

## One variable without a config

A `@@property` block declares a variable on its own, and it is a binding like any other:

```tsx
export const angle = @@property(
  syntax: "<angle>";
  inherits: false;
  initial-value: 0deg;
);

const turn = @@keyframes(
  from { $(angle): 0deg; }
  to { $(angle): 180deg; }
);

const dial = @@(
  transform: rotate(var($(angle)));
  animation: $(turn) 1.2s linear infinite;
);
```

**Reach for this when the registration is the point.** `<angle>` above is the reason `rotate()` can
be animated at all — an unregistered custom property is a string to the engine and does not
interpolate — and `inherits: false` is a choice `$` does not offer, because a design token that does
not inherit is not a design token.

It is also the shorter road when there is one variable, local to one file, and no config yet.

A misspelling is not a CSS problem here, it is an unresolved name: `var($(ackcent))` is *Cannot find
name 'ackcent'. Did you mean 'accent'?*, from TypeScript, with the suggestion it already knows how
to make.

## A font, and an animation

```tsx
const brand = @@font-face(
  font-family: "Brand";
  src: url("/brand.woff2") format("woff2");
  font-display: swap;
);

const slide = @@keyframes(
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
);

const panel = @@(
  font-family: "Brand", sans-serif;
  animation: $(slide) 240ms ease-out;
);
```

**The rule goes to the stylesheet and the site becomes its name.** The name is a hash, because a
whole `@keyframes` has no short spelling the way one declaration does — so the same animation
written in two files is one rule.

`slide` is then an ordinary binding, and that is what makes the reference checkable: a typo is an
unresolved identifier. Written in a stylesheet instead, the name would be a string on both sides and
`animation: slidein` would be one typo away from silence.

A reference resolves **when the file compiles**, not on the element, so `$(slide)` costs no custom
property.

`@@font-face` names nothing — the `font-family` inside it is the handle, and that is the string
other rules match on, so its block is written for its own sake. The other two name something, and
`@@property` names a **custom** property, so what it compiles to is `--r-…` with the dashes: that is
the one name `{ }` may stand in where a property name goes, which is how the frames in the previous
example set it.

## A name nothing sets

A plain `var(--name)` is checked against every name the whole build sets — not only the block it is
written in, so a parent setting what a child reads needs no ceremony:

```tsx
const table = @@( --row-height: 32px; );
const row = @@( height: var(--row-height); );
```

A name nothing sets is reported, with the four things that would make it exist:

> nothing in this build sets `--brnad`. Did you mean `--brand`?
> Set it in a block, register it with `@@property`, add it to `alsoSets` in `ramonda.css.ts` if it
> comes from a stylesheet this does not compile, or give it a fallback — `var(--brnad, <value>)` —
> which says it may be absent.

A fallback is the answer most of the time, and it is CSS you would write anyway.

## Theming

**A theme is custom properties, and a block reads them.** Nothing here is a theme system, which is
the same position [styling](/styling) takes: switching a theme is one attribute on `<html>` — no
render, no JavaScript per element, and the block does not know a theme exists.

Declare the tokens with a `range` that admits what the theme sets, and override them in an ordinary
stylesheet:

```css
[data-theme="dark"] { --color-accent: #34d399; --color-surface: #0b0b0b; }
```

```tsx
const card = @@(
  background: $color.surface;
  border-left: 4px solid $color.accent;
);
```

The values on `:root` come from `variables.css`, so the override is the only CSS you write.

**A variable with no `range` cannot be overridden.** It was declared as one value, so setting it
anywhere is refused — in a block, in a stylesheet the app loads (by the Vite or esbuild plugin, at the
file and line), and in a `style` attribute (in the editor and `ramonda-check`). The message says to
give it a `range`. A value outside a `range` is refused the same way.

### `light-dark()` resolves where the variable is set

A declared variable is registered with `@property`, which gives it a type and a computed value —
and that is what makes `light-dark()` behave differently here than in a hand-written stylesheet. The
pair is resolved on the element that **sets** the variable, and every descendant inherits the
answer. A `color-scheme` further down does not change it:

```css
:root  { color-scheme: light dark; --color-surface: light-dark(#ffffff, #0b0b0b); }
.panel { color-scheme: dark; }   /* the surface inside this is still the light one */
```

So a region that forces a scheme sets the values it wants, rather than switching the scheme and
expecting the pair to follow:

```css
[data-scheme="dark"] { --color-surface: #0b0b0b; }
```

That is also the form that works for every kind. `light-dark()` is colour only — a length written
that way is dropped, and the variable keeps its `initial-value`.

### A value on the element is not a theme

A [registered property](/style-blocks/dynamic) set from `style` is the right answer for what varies
per **instance** — a value this element has and the one beside it does not. A theme is the opposite
of that, and the difference is **who sets it**.

A value set per element travels in the markup, once on every element that carries it — on a long
server-rendered list, once per row. On `:root` it is written once, and every element inherits it.

And a theme switch done per element is a **render**: every element carrying the value has to render
again to change it. A `var()` reading `:root` changes when the attribute on `<html>` changes, which
is not a render at all.

## `:root` does not go inside a block

```tsx expect-report:root-in-a-block
const card = @@(
  :root { --accent: red; }
);
```

A block is one element's rule, so everything in it is nested inside that rule — and `:root` there
means `.r-… :root`, the root under the element. `:root` is the `<html>` element, which is nobody's
descendant, so the rule would apply nowhere; it is reported instead. A theme's own declarations
belong in a stylesheet, and this project's own belong in `ramonda.css.ts`.

The other way round is fine: `:root.dark & { … }` is the element under the root, which is how a
theme reaches a block.

## Next

- **[The config file](/style-blocks/config)** — everything else `ramonda.css.ts` holds, including
  what a project can forbid.
- **[Composing](/style-blocks/composing)** — reusing a block, conditions, and which declaration
  wins.
