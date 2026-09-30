---
title: Values that come from data
description: A style block is compiled before your app runs, so a value your app computes is set on the element instead — declared once, typed, and named by the compiler.
section: Style blocks
order: 111
---

# Values that come from data

A block is compiled before your app runs. Everything in it becomes a class that already exists in
the stylesheet, which is what makes two elements with the same styles share one rule.

A value your app computes at run time cannot be in a class, because the class was written before the
value existed. A progress bar's width, a colour chosen by somebody, the offset of a row in a
virtualised list — each of those is one element's own value, and CSS has one place for that: a
**custom property**, set on the element.

Declare it, read it in the block, and set it where the element is written.

## Declaring one

```tsx
const width = @@property(
  syntax: "<percentage>";
  initial-value: 0%;
  inherits: false;
);
```

That is a real `@property` rule in the stylesheet, and the binding is its name — the compiler
generates one, so it cannot collide with anything and cannot be mistyped.

## Reading it

```tsx
const width = @@property( syntax: "<percentage>"; initial-value: 0%; inherits: false; );

const bar = @@( height: 8px; background: $.color.accent; width: var({width}); );
```

`var({width})` is resolved when the block compiles, so `width` is written into the rule as text.
Nothing about this declaration is per-element: `bar` is one class, shared by every bar on the page.

## Setting it

```tsx
<div className={bar} style={{ [width]: `${this.done}%` }} />
```

The binding is the property's name, so it goes straight in as a key.

### `toStyle` checks the value against the `syntax` you declared

A plain object key takes any string, so the line above is as checked as any other object. `toStyle`
is the same set with the type kept:

```tsx
import { toStyle } from "@ramonda/css";

const done = @@property( syntax: "<percentage>"; initial-value: 0%; inherits: false; );
const meter = @@( height: 8px; width: var({done}); );

const Bar = (props: { at: number }) => (
  <div className={meter} style={toStyle([[done, `${props.at}%`]])} />
);
```

```
toStyle([[angle, "45deg"]]);     ✓
toStyle([[angle, "45px"]]);      ✗  a length where `<angle>` was declared
```

It takes several at once, and it takes declared variables — `$.color.accent` — in the same list, so
one call sets everything an element carries.

The binding's type is `CssVar<"angle">`, read from the `syntax` you wrote. That is also what a
function annotates when it takes *any angle property this app registered*:

```tsx
import type { CssVar } from "@ramonda/css";
import { toStyle } from "@ramonda/css";

const spin = (name: CssVar<"angle">, deg: number) => toStyle([[name, `${deg}deg`]]);
```

A `syntax` the type system has no kind for — `"*"`, or a compound grammar like
`"<length> | auto"` — binds `CssVar<"any">`, which takes what CSS itself would.

### A property nothing sets is reported

`initial-value` is required, so a property nothing ever sets still renders — every element gets the
initial, the page looks fine, and nothing says the value you meant to vary never arrives. So it is a
finding:

```
src/Dial.tsx:1:15  registered-never-set
  `angle` is read by a block and set by nothing, so every element gets its `initial-value`.
```

Anything that mentions the binding in TypeScript counts as setting it — `style`, `toStyle`, a helper
you pass it to. The rule fires only when the name is written in exactly one place, its own
declaration, and read from blocks.

**One shape it is wrong about:** a library that exports a registered property for its consumers to
set. Those consumers are not in the program, so there is nothing for it to see. Put a
`// ramonda-css-ignore <reason>` on the line above the declaration, or turn the rule off in
[`ramonda.css.ts`](/style-blocks/config).

## Declared once, read anywhere

A declared property is **one variable however many declarations read it**. A block reading one
property twice compiles to:

```
@property --r-pHqJVsKzI { syntax:"<length>"; initial-value:0px; }
.r-pl-var(--r-pHqJVsKzI) { padding-left: var(--r-pHqJVsKzI); }
.r-pr-var(--r-pHqJVsKzI) { padding-right: var(--r-pHqJVsKzI); }
```

One name, two classes reading it. So you set it once and every declaration that reads it moves
together.

## What `syntax` buys, beyond tidiness

**The browser checks the value.** A property declared `<percentage>` and handed `12px` is not
applied at all, and the `initial-value` stands instead — so a wrong value degrades to a known one
rather than to nothing.

**It can be animated.** A custom property the browser knows nothing about is a string, and a string
cannot be interpolated. A registered one has a type, so `transition: width 200ms` on a property the
browser understands actually moves:

```tsx
const angle = @@property( syntax: "<angle>"; initial-value: 0deg; inherits: false; );

const dial = @@(
  transform: rotate(var({angle}));
  transition: transform 200ms ease-out;
);
```

**`initial-value` is a real fallback.** An element that never sets the property still renders,
with the value you declared — not with the declaration missing.

## A name nobody else can take

A custom property **inherits**. A card setting `--accent` changes every descendant whose own block
reads that name, which is a feature when you mean it and a collision when you do not.

The compiler's names cannot collide by accident: each is derived from the declaration itself, so two
different properties never agree on one. Declaring `inherits: false` closes the other half — the
value then reaches the element it was set on and no further.

## Across a component boundary, send the VALUE

A component that takes a style from its parent takes a block — see
[styles a caller may send](/style-blocks/prop). A component that varies with data takes the **data**:

```tsx
const width = @@property( syntax: "<percentage>"; initial-value: 0%; inherits: false; );
const bar = @@( height: 8px; width: var({width}); );

class Bar extends Component<{ done: number }> {
  render() {
    return <div className={bar} style={{ [width]: `${this.props.done}%` }} />;
  }
}
```

`done` is a number. A number is the same value on every render that computes it the same way, so
nothing downstream has to decide whether it changed — where an object built in the markup is a new
one each time, and everything holding it has to look inside to find out that nothing moved.

## What this costs, honestly

Two places instead of one: the block says what reads the value, and the element says what it is.
Nothing in the language ties them together, so a block that reads a property whose element never
sets it renders with the `initial-value` and says nothing about it.

That is the trade for a stylesheet that is written once and an element that carries only what is
truly its own.

## Next

- **[Names the stylesheet sees](/style-blocks/variables)** — the other kind of variable: the ones
  your project declares in `ramonda.css.ts`, which are the same for everybody.
- **[Styles a caller may send](/style-blocks/prop)** — a prop that takes a block, and a type that
  says which declarations may go in it.
- **[Writing a block](/style-blocks/writing)** — the syntax this page assumes.
