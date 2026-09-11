---
title: Writing a block
description: The two places a block goes, what each declaration becomes, nesting with &, and holes for the values that change.
section: Style blocks
order: 107
---

# Writing a block

A block is `@@( … )`, and what goes inside it is CSS.

## Two places it goes

A block is an ordinary **value**, so it goes anywhere a value goes. That gives two spellings, and
they compile to exactly the same thing:

```tsx
const one = <div css={@@( display: flex; )}>in the braces JSX already has</div>;

const panel = @@( display: flex; );
const two = <div css={panel}>a value, written somewhere else</div>;
```

Reach for the second whenever the block is long, or you want a name for it. Nothing about a block
requires JSX — `const panel = @@( … )` is a value like any other, and that is the point: **this
extends TypeScript, not JSX.** A block in a `.ts` file with no markup in it works the same way.

### A block at module scope reads its holes ONCE

A block is a value, and a value at module scope is built when the module loads. So a hole in one is
read at import time and then frozen:

```tsx
let theme = "#10b981";

// Every element using this carries #10b981 for the life of the page, even
// after `theme` changes. The hole was read when this module loaded.
export const panel = @@( border-left: 4px solid {theme}; );
```

Measured, on what the transform emits: `_merge({"border-left": ["r-…", theme]})` — an ordinary
expression in an ordinary initialiser, evaluated once. Nothing reports this today.

**It bites hardest where a shared block is most tempting: a default somebody imports everywhere.**
That is the one place a stale value spreads across the whole app rather than one component.

Three shapes that do not have the problem:

```tsx
// 1. No hole — nothing to freeze, and the class is shared by every element that names it.
export const panel = @@( display: flex; gap: 8px; );

// 2. A function, so the hole is read per call.
export const panelFor = (theme: string) => @@( border-left: 4px solid {theme}; );

// 3. A custom property, which is what a value the whole app shares should be anyway.
export const panel2 = @@( border-left: 4px solid var(--theme); );
```

**The third is the real answer for a theme**, and it is cheaper as well as correct — see
[a hole is not a theme](/style-blocks/variables#a-hole-is-not-a-theme), where the same choice is
measured at 41 bytes on every element.

## Each declaration becomes one class

```tsx
const row = <div css={@@( display: flex; gap: 8px; )}>x</div>;
```

ships as

```html
<div class="r-disp-flex r-gap-8px">x</div>
```

Two files that write `display: flex` get **the same class**, without knowing about each other,
because the name is derived from the declaration and from nothing else. That is also what makes
[composing](/style-blocks/composing) possible: merging two blocks keeps, per thing set, the one
written later — and it can only do that if each thing set has a class of its own to keep or drop.

Each file carries the rules it names in its own stylesheet, so a code-split route stands on its own.
Where two files produce identical stylesheets the bundler dedupes them by content, and it costs
nothing.

## `&` is CSS, not ours

`&` means **the thing this rule is nested in**. It is CSS Nesting, standardised in 2023 and in every
current browser, and the browser resolves it — nothing here rewrites it.

```tsx
const card = @@(
  padding: 12px;
  &:hover { background: #f8fafc; }
  &.active { border-color: #10b981; }
  & .title { font-weight: 600; }
);
```

Two of CSS's own rules surprise people, so they are worth saying out loud:

- **The space matters.** `& .title` is a descendant; `&.title` is the same element carrying both
  classes. One character, two different rules.
- **A prelude that names no parent gets one.** `div { … }` inside a block means `& div`, which is
  what CSS Nesting says a bare selector means. The two compile to the same class.

## Holes, for the values that change

A `{ … }` hole carries a TypeScript expression into the CSS. Each one becomes **one CSS custom
property on the element**, so a value that differs per instance costs a property rather than a rule:

```tsx
class Row extends Component {
  @state weight = 4;

  render() {
    return (
      <div css={@@(
        border-left: {`${this.weight}px`} solid #ff0055;
        &:hover { border-left-color: #00b37e; }
      )}>
        a row
      </div>
    );
  }
}
```

The expression stays where you wrote it, so `this.weight` is the field beside it and is type-checked
in that scope.

### A hole holds a value, and only a value

```
border-left: {width};             ✓  a value
{name}: 24px;                     ✗  a property name
&:{state} { … }                   ✗  a selector
{on ? "display:flex" : ""}        ✗  a whole declaration
```

The last is refused rather than mangled. A value carrying a `;` is refused outright — on the server
too, where it would otherwise become real declarations in the markup.

There is one exception to the second line: a name that came from `@@property( … )` may stand where a
property name goes, because the compiler generated that name and nothing else can write it. See
[names the whole stylesheet sees](/style-blocks/variables).

### The unit goes inside the hole

```
padding-left: {`${n}px`};          ✓  the hole carries its own unit
padding-left: calc({n} * 1px);     ✓  the arithmetic is CSS's
padding-left: {n}px;               ✗  reported
```

A `var()` is substituted as **tokens**, so the `12` and the `px` in `var(--w)px` never become one
length. Measured in a browser, with `--w: 12`:

| written | computed |
|---|---|
| `padding-left: var(--w)px` | **`0px`** |
| `padding-left: 8px; padding-left: var(--w)px` | **`0px`** — the fallback above it is lost too |
| `padding-left: calc(var(--w) * 1px)` | `12px` |
| `--w: 12px; padding-left: var(--w)` | `12px` |

Invalid at computed-value time is worse than invalid at parse time: the property falls back to its
initial value **and takes any earlier declaration of it with it**. So text written against a hole is
reported — a unit, a suffix, a `#` in front, on either side.

## One value, read many times

Write the hole wherever you need the value. That is the whole answer for almost every block:

```tsx
declare const accent: string;

const card = @@(
  border-left: 4px solid {accent};
  background: {accent};
  color: {accent};
);
```

A hole belongs to the declaration it is written in, so this puts **three** custom properties on the
element rather than one, all holding the same value — a rule is shared by every element that names
it, so its variable cannot be named after anything but itself.

**Whether that matters is a number, and the number is small.** On a real block reading one value
five times, measured: the `style` attribute is 102 B written directly, and 24 B if you declare a
custom property once and read it. **Seventy-eight bytes an element.** On one card that is nothing;
on a list of a hundred rows it is 7.8 KB of markup, and then it is worth a line:

```tsx
declare const accent: string;

const row = @@(
  --accent: {accent};
  border-left: 4px solid var(--accent);
  background: var(--accent);
  color: var(--accent);
);
```

The three declarations below it have no hole at all now, so they are static classes that dedupe with
every other block writing the same thing. **Reach for this when a block repeats across many
elements, not by default** — the direct form is shorter to read and to write, and 78 bytes is not a
reason.

**The name is yours, and a custom property INHERITS.** `--accent` is set on the element and is
visible to everything inside it: measured, a descendant that reads `var(--accent)` and never sets one
picks up the ancestor's value, a descendant that sets its own shadows it, and an element outside the
subtree falls back. That is a feature when you mean it and a collision when you do not — a card
setting `--accent` changes any descendant whose own block reads that name.

So pick a name you would be happy to see inherited, or one nobody else would write. The names the
compiler generates for holes never have this problem: `--r-<class>-0` is derived from the declaration
itself, so two different declarations can never agree on one by accident.

## A hole may not be empty

`string | number`, and nothing else. `undefined` and `null` are refused, so a value that might not be
there needs a fallback written where it is used:

```
color: {tint};                   ✗  TS2345 — `null` is not a value
color: {tint ?? "inherit"};      ✓
```

An empty hole is not a declaration you can see. It is a `var()` with nothing behind it, which makes
the whole declaration invalid at computed-value time — so the property falls back past **every
earlier declaration of it**, including the one you spread in above.

On a server-rendered page it is worse in one direction: a hole that has a value on the server and
none on the client is a divergence, and the page keeps showing the server's value. Write the empty
case out and neither happens.

## The value carrying a unit can be typed

A hole's value is `string | number`, and it has to be: **349 of 551 properties are composite**.
`border-left` is `<line-width> || <line-style> || <color>`, so `4px solid red` in any order — a type
narrow enough to refuse `4px sollid red` would refuse `red 4px solid`, which is correct CSS.

So the type goes where the value is **made**, which is the better place anyway: the error lands on
the line somebody wrote.

```
const border: CssDimension = `${weight}px`;      ✓
const border: CssDimension = `${weight}pddx`;    ✗  TS2322, on this line
```

No `as const` is needed — the annotation is the context — and it works in a getter, which is where a
value like this usually comes from:

```tsx
import type { CssDimension } from "@ramonda/css";

class Card {
  weight = 4;
  get border(): CssDimension {
    return `${this.weight}px`;
  }
}
```

**The unit set is a parameter**, so an app that has settled on one says so:

```
const gap: CssDimension<"px"> = `${n}rem`;       ✗  TS2322 — this app writes px
```

There is a union per family — `CssLengthUnit`, `CssAngleUnit`, `CssTimeUnit`, `CssResolutionUnit`
and `CssFrequencyUnit` — so `CssDimension<CssLengthUnit>` is a length and refuses `12deg`. All of
them are generated from the same unit table the checker measures a typo against, so the two cannot
disagree.

One looseness, on purpose: **any call is admitted.** `calc()`, `min()`, `clamp()` and `var()` can
each produce any dimension and nothing in a type can read inside one, so `calc(1rem + 2px)` passes
`CssDimension<"px">`. Refusing calls would make the type useless in the one place you reach for it.

## Comments

A block is CSS, so its comment is CSS's, and it is stripped from the emitted rule:

```tsx
const card = @@(
  /* the dot is the level, and it is set from the theme */
  display: grid;
  gap: 8px;      /* matches the list beside it */
);
```

**`//` is not a comment here, and it does not fail quietly.** CSS has no line comment, so the
characters go into the stylesheet as they stand:

```
.r-3f96…{// why
  color:red;gap:8px;}
```

and the CSS compiler refuses the **whole file** — measured, `SyntaxError: Unexpected token
Semicolon` — naming nothing about the block, the file, or the line it came from. A build that fails
somewhere else entirely, because of a comment. So it is reported before it gets there, as
`line-comment`, on the `//` itself.

Inside a hole a comment is TypeScript's, because that is what a hole holds:

```tsx
const card = @@(
  color: {/* the brand, not the accent */ "#ff0055"};
);
```

## Next

- **[What is checked](/style-blocks/checking)** — every rule and what it catches.
- **[Composing](/style-blocks/composing)** — reusing a block, conditions, and which declaration wins.
