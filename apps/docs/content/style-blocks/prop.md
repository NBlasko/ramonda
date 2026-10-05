---
title: Styles a caller may send
description: A prop that takes a style block, and a type that says which declarations a caller may put in it, and which values.
section: Style blocks
order: 115
---

# Styles a caller may send

A component that takes styles through a prop has to answer a question: **what may a caller change?**
Without a type it has no answer at all.

```tsx
class Card extends Component<{ css?: CssBlock }> {
  render() {
    return <div className={@@( display: flex; ...$(this.props.css); )}>…</div>;
  }
}
```

`CssBlock` on its own takes every block there is. A caller may change the padding, the position, the
display — anything — and the component finds out when something looks wrong on a page.

**`CssBlock` is a type you import**, and where from depends on whether your project has a
[`ramonda.css.ts`](/style-blocks/config). With one, codegen puts it in the generated `css-system`
beside the token groups and `AnyToken`, which is the one import a component needs:

```ts
import type { AnyToken, CssBlock } from "./css-system";
```

Without a config there is no `css-system`, and it comes from `@ramonda/css/properties`.

## The allow-list

Give the type an allow-list, and it becomes an answer. The properties are the keys, and each key's
**type** is what that property may be set to.

```tsx
type CardStyle = {
  color?: Token<"color">;
  gap?: "8px" | "16px";
  "&:hover"?: { color?: Token<"color"> }[];
};

class Card extends Component<{ css?: CssBlock<CardStyle> }> {
  render() {
    return <div className={@@( display: flex; gap: 8px; ...$(this.props.css); )}>…</div>;
  }
}
```

That is a block shape used as a type. It is written in the spelling a block is already written in —
the CSS names, dashed and quoted where CSS dashes them — so there is nothing new to learn.

**Write it as a `type`, not an `interface`.** An interface gets no implicit index signature, so
TypeScript will not accept one where a block shape is wanted — whatever is inside it, and even with
no state at all. `allow-list-is-an-interface` says so in those words, because the compiler's own
message names an index signature you never wrote and never says `interface`.

**A state is a list of its own**, because that is what a nested rule compiles to: one entry per
declaration. Write it `{ … }[]` and not `[{ … }]` — a one-element tuple gives the first declaration
inside the state a type and accepts whatever the rest set, so the slot would stop constraining the
state after its first line. `state-is-a-tuple` reports the tuple, because nothing else would: it
type-checks, it builds, and the caller it stops protecting is told nothing.

`Token<"color">` is any declared colour, and it comes from `@ramonda/css`. A caller may recolour a
card and may not write `#ff0055`, so the palette stays the one place colours are decided.

A project usually wants the narrower one. Codegen writes `AnyToken<"color">` into the `css-system` beside
`ramonda.css.ts`, and it is **this project's own** colours rather than any declared anywhere — the
same shape, one step tighter. [Names the stylesheet sees](/style-blocks/tokens) is where both
come from.

## Where a fault lands

On the thing the author got wrong, never on the call:

| a caller writes | what they are told |
|---|---|
| `color: $color.accent` | nothing — it is a declared colour |
| `color: red` | on the **value** — a bare colour where a declared one is wanted |
| `color: inherit` | nothing — see below |
| `padding: 4px` | on the **property** — `padding` is not in `{ color?: …; gap?: …; "&:hover"?: … }` |
| `&:hover { padding: 4px }` | on `padding`, **inside** the state |
| `&:focus { … }` | on the state — this component does not offer it |
| `& > span { … }` | on the selector |

Two of those need no rule of their own. **A combinator is refused because it is not a key**, so a
component's internal structure never becomes part of its API. And `!important` stops being writable
the moment a value is narrowed to a list.

**A narrowed value still takes `inherit`**, and its companions `initial`, `unset`, `revert` and
`revert-layer`. They come from CSS itself, not from a project's choices, so `{ color?: Token<"color"> }`
takes `color: inherit` without saying so. It takes nothing else extra: `color: red` and
`color: inherit !important` are still refused.

## One prop is one element

A component with more than one styleable part gives each part its own prop, named after it:

```tsx
type CardStyle = { color?: Token<"color"> };

class Card extends Component<{
  css?: CssBlock<CardStyle>;
  titleCss?: CssBlock<{ "font-weight"?: 400 | 600 }>;
}> {
  render() {
    return (
      <div className={@@( display: flex; ...$(this.props.css); )}>
        <h2 className={@@( ...$(this.props.titleCss); )}>…</h2>
      </div>
    );
  }
}
```

`css` is the element the component **is**, and `<part>Css` is a part it promises. The name is the
component's own — a `<div>` has no `css` prop, since a block is a string and goes on `className` —
and it is worth keeping for what it says: *styles for this element*, told apart from the class names
a caller might also have.

Reaching a part through a combinator would be reaching into a structure the component is free to
change tomorrow. A named prop is the opposite: it is promised, and the component has to keep it
working.

## A caller cannot send a run-time value

A value computed while rendering cannot go into a declaration in any block — a hole is refused
everywhere — so nothing a caller writes into `css` costs anything per element, and the allow-list is
the whole of what they may change. A value that really varies per element is sent as data instead:
see [values that come from data](/style-blocks/dynamic), and [composing](/style-blocks/composing)
for `when`, `match` and the spread.

## Five things the checker watches

**A prop that never reaches a block.** A caller sends styles, the component never puts them on an
element, and nothing fails — the styles simply do not arrive. It is reported where the prop is
declared, and a prop counts as used when it is spread into a block, put on `className`, or handed
to another prop that takes a block.

**A declaration below the spread that clears what a caller may send.**

```tsx
class Broken extends Component<{ css?: CssBlock<{ "padding-left"?: string }> }> {
  render() {
    return <div className={@@( ...$(this.props.css); padding: 8px; )}>…</div>;
  }
}
```

`padding` clears `padding-left`, exactly as CSS says — so the merge is not wrong. What is wrong is a
component that promised a property in its type and then took it back. There are two fixes and both
are right: move the spread below, or take the property out of the type.

**And three things about the allow-list itself** — `state-is-a-tuple` and
`allow-list-is-an-interface`, both above, and `allow-list-not-css`: a value in it that is not CSS.
`"font-weight"?: "notexisting"` is a type that looks fine and refuses every caller, since nobody can
send that value — so it is reported where you wrote it, judged by the same rules as a declaration
in a block.

All five can be switched off by id in [`ramonda.css.ts`](/style-blocks/settings), and covered for
one line by [the ignore directive](/style-blocks/checking#when-a-rule-is-wrong).

## Next

- **[Composing, and who wins](/style-blocks/composing)** — the spread, `when` and `match`, and the order a
  merge settles.
- **[Names the stylesheet sees](/style-blocks/tokens)** — where `Token<"color">` and `$color` come
  from.
- **[Project settings](/style-blocks/settings)** — the same constraints written once for a whole
  project.
