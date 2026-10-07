---
title: Writing a block
description: The two places a block goes, what each declaration becomes, nesting with &, and where a value that changes goes instead.
section: Style blocks
order: 107
---

# Writing a block

A block is `@@( … )`, and what goes inside it is CSS.

## A block is a value, and that value is a string

The classes it compiled to, space separated — so it goes on `className`, in the attribute or in a
binding you name and use later:

```tsx
const card = <div className={@@( display: flex; )}>inline</div>;

const panel = @@( display: flex; );
const named = <div className={panel}>named, and reusable</div>;
```

Name it when it is long, when two elements share it, or when you want to
[compose](/style-blocks/composing) it into another.

**Beside a class of your own, use `mergeClassNames`:**

```tsx
import { mergeClassNames } from "@ramonda/css";

const row = <div className={mergeClassNames("lead", @@( display: flex; ))}>a row</div>;
```

Not a template literal. `` `lead ${@@( … )}` `` is text to the compiler, so a block written in one is
found by nothing at all — it is reported rather than compiled to silence. `mergeClassNames` is also what keeps
one class per thing set when two blocks meet; joining them with a space would keep both and let the
stylesheet break the tie.

**Nothing about a block requires JSX.** `const panel = @@( … )` is a value like any other, and a
block in a `.ts` file with no markup in it works the same way — this extends TypeScript, not JSX.

## Each declaration becomes a class

```tsx
const row = <div className={@@( display: flex; color: #333; )}>x</div>;
```

ships as

```html
<div class="r-disp-flex r-c-#333">x</div>
```

A shorthand becomes the longhands it sets, each a class of its own — `padding: 8px` is four of them.
[Shorthands](/style-blocks/shorthands) is what that changes, which is less than it sounds.

Two files that write `display: flex` get **the same class**, without knowing about each other,
because the name is derived from the declaration and from nothing else. That is also what makes
[composing](/style-blocks/composing) possible: merging two blocks keeps, per thing set, the one
written later — and it can only do that if each thing set has a class of its own to keep or drop.

Each file carries the rules it names in its own stylesheet, so under Vite a code-split route stands
on its own; esbuild puts them all in the entry's sheet — see [a code-split app](/style-blocks#a-code-split-app).
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

## A value in a declaration is written out

Everything in a block is decided when the block compiles. A TypeScript expression standing in for a
declaration's value — `$( … )`, a hole — is refused:

```
color: $(this.brand);            ✗  hole-not-allowed
```

Three things cover what a hole would be reached for.

**If the value is one of two, write the choice.** Both values become classes and the condition picks
one — see [a choice between two values](/style-blocks/composing#a-choice-between-two-values):

```tsx
class Note extends Component<{ urgent: boolean; text: string }> {
  render() {
    return <p className={@@( color: $(this.props.urgent) ? #ef4444 : #374151; )}>{this.props.text}</p>;
  }
}
```

**If the value is one of a few, write them all out.** [`match`](/style-blocks/composing#match-one-value-several-outcomes) makes each
arm its own rule and its own class, so the subject only picks between classes that already exist:

```tsx
class Chip extends Component<{ tone: "hot" | "cold" }> {
  render() {
    return (
      <span className={@@(
        padding: 4px 10px;
        color: match $(this.props.tone) {
          hot  => #ff0055;
          cold => #0ea5e9;
        };
      )}>{this.props.tone}</span>
    );
  }
}
```

**If it really comes from data, declare it.** `@@property( … )` gives you a name the whole stylesheet
can read and your element can set — one name however many declarations read it:

```tsx
const width = @@property( syntax: "<percentage>"; initial-value: 0%; inherits: false; );

const meter = @@( height: 8px; width: var($(width)); );
```

That page is [values that come from data](/style-blocks/dynamic), and it is worth reading before you
reach for either.

### Why a hole is not simply allowed

A value written in a block becomes a class, shared by every element that carries it: `color: red`
emits `r-c-red { color:red; }`. A value from data cannot be a class, so a hole in a declaration
would have to be written on every element instead — a list of ten thousand rows, ten thousand style
attributes.

And a hole would belong to the declaration it stood in, so two declarations wanting one value would
get two custom properties:

```
padding-left: {v}; padding-right: {v};             TWO variables, two classes
padding-left: var({pad}); padding-right: var({pad});   ONE, however many read it
```

**`$( … )` is how an expression gets in**, and everywhere else it stands is untouched, because none
of them puts a value on an element: `when $(…)` and `...$(…)` choose between whole rules,
`match $(…)` and `$(…) ? a : b` choose between classes, and `var($(name))` names a `@@property`
site the compiler resolves before the CSS is written.

## A value you build in TypeScript can be typed

Nothing goes into a block from TypeScript, but plenty goes onto an ELEMENT — the value you set a
[registered property](/style-blocks/dynamic) to, or a theme you hand to `toStyle`. Those are strings
you build, and they can be held to a shape.

**The type goes where the value is made**, which is where the error is worth having: on the line
somebody wrote, not on the element that used it.

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

### In a project with a config, name the property instead

`CssDimension` says *a length*. When your project has a
[`ramonda.css.ts`](/style-blocks/config), `Value<"gap">` says *whatever `gap` takes here* — units
narrowed, closed lists, `hardcoded: false` and all. One property, one name, and the answer moves
when the config does.

**For a value made at run time, this type is the only place that rule holds.** A block reads such a
value through `var()`, and `gap: var($(space))` is accepted however your config narrows `gap` — the
value does not exist yet. The `style` attribute takes any string. So the type goes on the value,
where it is made — most often a prop:

```tsx
import type { Value } from "../css-system";

const space = @@property( syntax: "<length>"; initial-value: 8px; inherits: false; );
const stack = @@( display: flex; gap: var($(space)); );

class Stack extends Component<{ gap: Value<"gap"> }> {
  render() {
    return <div className={stack} style={{ [space]: this.props.gap }}>…</div>;
  }
}
```

In a project that writes `gap` in `px`, `<Stack gap="3rem" />` is refused on the caller's line.

**The stylesheet cannot hold that rule for you.** A registered property's `syntax` names a type —
`<length>` — and never a list of lengths, so `@property` has no way to say *8px or 16px*. The
narrowing reaches a value made at run time only through its type, which is why the value set on
`space` above is a `Value<"gap">` rather than a `string`. The
same type holds a value your code chooses before setting it — from data, a measurement, or more
than one condition:

```tsx
import type { Value } from "../css-system";

const gapFor = (rows: number): Value<"gap"> => (rows > 50 ? "4px" : "8px");
```

**Inside a block you never need it.** A value written there is checked as it is, and a choice
between fixed values is a [choice](/style-blocks/composing#a-choice-between-two-values) —
`gap: $(dense) ? 4px : 8px;` — which compiles to two classes and sets nothing on the element.

And `AnyToken<"color">` is *any token this project declares of that kind* — which is what you want when
a function chooses between them and hands the one it picked on:

```tsx
import { read } from "@ramonda/css";
import { $color } from "../css-system";
import type { AnyToken } from "../css-system";

declare const loud: boolean;

const pick = (): AnyToken<"color"> => (loud ? $color.accent : $color.surface);
const now = read(pick(), document.body);
```

**Inside a block, a choice between two tokens is a [choice](/style-blocks/composing#a-choice-between-two-values)
instead** — `color: $(loud) ? $color.accent : $color.surface;` — and both become classes.

## Comments

A block is CSS, so its comment is CSS's, and it is stripped from the emitted rule:

```tsx
const card = @@(
  /* the dot is the level, and it is set from the theme */
  display: grid;
  gap: 8px;      /* matches the list beside it */
);
```

**`//` is not a comment here.** CSS has no line comment, so the characters would go into the
stylesheet as they stand, and the CSS compiler would refuse the **whole file** — naming nothing about
the block, the file, or the line it came from. So it is reported before it gets there, as
`line-comment`, on the `//` itself.

Inside `$( … )` a comment is TypeScript's, because that is what the escape holds:

```tsx
declare const loud: boolean;

const card = @@(
  when $(/* the brand, not the accent */ loud) { color: #ff0055; }
);
```

## Next

- **[What is checked](/style-blocks/checking)** — every rule and what it catches.
- **[Composing](/style-blocks/composing)** — reusing a block, conditions, and which declaration wins.
