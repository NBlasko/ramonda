---
"@ramonda/css": minor
"@ramonda/core": minor
---

**The `css` prop is gone.** A block compiles to its classes, so `className` takes one.

```tsx
const panel = @@( display: flex; gap: 8px; );

<div className={panel} />
<div className={@@( display: flex; )} />
<div className={mergeClassNames("lead", @@( display: flex; ))} />  // beside a class of your own
```

There is nothing a second prop could do that the first cannot. It was an object carrying custom
property names and this render's values for them — which `className` could not have held — and it
has not been one since a runtime value in a declaration was refused.

**It is declared as a message rather than deleted**, because deleting it would be silent: the
element attribute type ends in `[val: Lowercase<string>]: any`, so a removed `css` would be `any`,
the block would compile, the class string would be written onto the element as a `css` attribute,
and nothing would say so. What a reader gets instead is the sentence, printed by TypeScript as the
expected type.

**`block-in-a-template` is new, and it is the gap this opened.** Joining a block with a class of your
own is an ordinary thing to want now, and a template literal is the first thing anybody reaches for
— and a template literal is TEXT to the compiler, so `` `lead ${@@( color: red; )}` `` used to find
no block at all: the file was handed on untouched, `@@(` survived into the bundler, and the author
got a syntax error somewhere else entirely. Measured across every position a block can be written in
— attribute, assignment, call argument, object value, array element, `return`, arrow body, ternary —
a template substitution is the only one that finds nothing, so it is reported, with
`mergeClassNames` named as the answer.

Gone with it: `applyCssBlock`, `CssBlockValue`, `RMD064`, and the `css` case in `formatAttributes`.
A component's own prop may still be CALLED `css` — `Card({ css?: CssBlock<CardStyle> })` — and that
is where an allow-list still narrows.
