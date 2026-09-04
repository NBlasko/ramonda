---
"@ramonda/core": minor
---

The `css` prop: an element takes a compiled style block

A style block is written in real CSS beside the markup and compiled, before the build, into a class
that already exists in a stylesheet plus one CSS custom property per carried expression. This is the
framework's half — by the time a value reaches an element there is nothing left to parse:

```tsx
<div className="lead" css={_s0(isOnline ? "4px solid #10b981" : "4px solid #64748b")}>
```

The generated class joins whatever `className` the element already has, and each hole is written with
`setProperty`. Both work on an SVG element too, where `className` is a read-only `SVGAnimatedString`
and the class has to go through the attribute — the block's class travels the ordinary `className`
path, so that is true without a second rule for it.

**A block is exempt from the double-render check.** A `css` value with holes is a fresh object on
every render because a per-element value IS one, so `RMD020` would be right about every element
carrying a block and useless on all of them. It joins `children` and the props a component declared
with `@StableProps`: the value is generated, and a fresh identity for it means nothing.

**A hole's value that would become a second declaration is refused.** A hole carries whatever the
author's expression evaluated to, and an expression can read a record — so "the author wrote it" is
not a defence. `setProperty` writes one declaration whatever it is handed, which closes it on the
client; it does not close it on the server, and that took a measurement to find. A server render is
serialized to HTML and the browser parses the style attribute back, and the parse applies the CSS
grammar to whatever the serializer wrote:

```
red; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999
```

came back through `renderToString` and `innerHTML` as `position: fixed`, `width: 100vw` and
`z-index: 9999` — real, applied declarations, a full-viewport overlay out of a colour that came from
a database. A value carrying a `;` is now dropped rather than written: the element is left unstyled
in that one respect, which is the right way round.

**Across the hydration boundary**, measured through a real server render and hydrate: the same value
on both sides is silent and correct; a value that differs is silent and the client's wins; a block on
only one side is put on or taken off, and the class disagreement is reported as it already was for
any other class.

`css` is declared explicitly on `RamondaArgs` and `SVGArgs` rather than left to the
`[val: Lowercase<string>]: any` index signature those types carry — an undeclared lowercase prop is
silently `any`, and nothing about the value would be checked. **This can break a `css` attribute
written for something else**, a custom element's own for instance: it now has to be a compiled block.
