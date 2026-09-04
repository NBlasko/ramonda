---
title: Style blocks
description: Real CSS written beside the markup and compiled before the build into one class and one custom property per hole, with every property and value type-checked.
section: Across the app
order: 119
---

# Style blocks

[Styling](/styling) is the framework's position: a `className`, a `style`, and stylesheets the way
they have always arrived. This page is about the one thing built on top of it, and it is a separate,
opt-in package rather than part of the framework.

```tsx
<div css=@(
  display: flex;
  gap: 8px;
  border-left: 4px solid #10b981;
)>
  Online
</div>
```

That is real CSS, written where the element is, and **compiled before the build**. What ships is a
class in a stylesheet and a `className` on the element. Nothing is parsed at runtime, nothing is
built per render, and the browser caches the stylesheet as a file like any other.

> **Not released yet.** `@ramonda/css` lives in this repository at `0.0.0` and is not published. The
> page is here because the syntax and its guarantees are settled; the version number is what is not.

## What a block becomes

**The static declarations become one class**, named after the hash of the block — so however many
elements carry it, and however many pages, there is one rule. Two files writing the same CSS get the
same class and the stylesheet holds it once.

**Each `{{ … }}` becomes one CSS custom property on the element.** A value that differs per instance
costs a property rather than a rule:

```tsx
class Row extends Component {
  @state weight = 4;

  render() {
    return (
      <div css={@(
        border-left: {{`${this.weight}px`}} solid #ff0055;
        &:hover { border-left-color: #00b37e; }
      )}>
        a row
      </div>
    );
  }
}
```

The nested `&:hover` is CSS's own nesting, resolved by the browser rather than by the compiler. Every
rule is emitted inside `@layer ramonda`, which sits beneath all unlayered CSS — so your own
`.row { border: none }` wins whatever order the files load in, and nobody has to reason about
specificity against generated output.

## Three ways to write one

```tsx
const one = <div css=@( display: flex; )>bare</div>;
const two = <div css={@( display: flex; )}>braced</div>;
const panel = @( display: flex; );
const three = <div css={panel}>a value</div>;
```

They compile to the same class and differ only in where the value is written. **Reach for a braced
one whenever the tag has other props**, and the reason is an editor limit rather than taste: an
editor stops consulting syntax injections the moment it enters a tag's attribute list, so a bare
attribute is only coloured when it is the first one, on the tag name's own line. In expression
position there is no such limit — any attribute, any line, and outside JSX as well.

The editor plugin says so where it matters: a bare block an editor cannot colour is marked as a
suggestion, on the attribute name, pointing at the braced spelling. It is a suggestion rather than a
warning because nothing is wrong — the block compiles and is checked either way, and a build has no
business failing over colours.

## Everything in it is checked

The syntax is not TypeScript, so the package owns a parser and a virtual-file layer — the same way
JSX is usable because somebody wrote the parser for it. What that buys is the checking:

- **A property that does not exist** is TypeScript's own *did you mean*, on the property.
- **A value the property does not take** is reported the same way, with the values it does take.
- **A hole is checked against the type the property accepts**, in the scope where it was written —
  `this.weight` resolves to the field beside it, because the expression stays where you put it.

## Where a hole may go

A custom property holds a **value**. That is the whole rule, and the three things it rules out are
worth writing down:

```
border-left: {{width}};             ✓  a value
{{name}}: 24px;                     ✗  a property name
&:{{state}} { … }                   ✗  a selector
{{on ? "display:flex" : ""}}        ✗  a whole declaration
```

The last one is refused rather than mangled: there is nothing to put a variable in, and a value
carrying a `;` is refused outright — on the server as well, where it would otherwise become real
declarations in the markup.

## What your tools need

**The build**: `ramondaCss()` in your Vite config, and nothing else — there is no stylesheet to
import, because the CSS is a module the bundler already knows about and follows the JavaScript chunk
it belongs to.

**Your editor**: a TypeScript plugin gives completion, hover and the red squiggles, and a TextMate
grammar gives the colours. They are separate on purpose — colours cost nothing, and a project that
has not asked for the compiler should not get it.

**Your formatter and linter**: neither biome nor Prettier nor oxlint can parse a file holding a block
until it is taught, and each refuses rather than mangles. The package ships a Prettier plugin, and
wrappers for the other two.

## What it does not do

**It is not CSS-in-JS.** Nothing about a block is JavaScript: it is compiled away before the bundle,
the class exists in a file the browser can cache, and no style is rebuilt on a render.

**It does not scope your other CSS.** A `className` is still the string you wrote, and the class in
your source is the class in the served HTML — see [styling](/styling).

**It is not a theme system.** A theme is a context and some custom properties, which needs nothing
from the compiler.

## Next

- [Styling](/styling) — `className`, `style`, and where stylesheets come from.
- [Performance](/performance) — why a value built in the markup costs more than it looks.
- [JSX](/concepts/jsx) — the rest of the attribute surface.
