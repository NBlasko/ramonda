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

Reach for the second whenever the block is long, or shared, or you want a name for it. Nothing about
a block requires JSX — `const panel = @@( … )` is a value like any other, and that is the point:
**this extends TypeScript, not JSX.** A block in a `.ts` file with no markup in it works the same way.

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
