---
"@ramonda/css": minor
"@ramonda/core": minor
---

**A block is a string.** `CssBlock` is the classes it compiled to, branded so a plain `string` cannot
stand in for one — and `mergeClassNames` composes strings rather than maps.

```tsx
const panel = @@( display: flex; gap: 8px; );

<div className={panel} />                        // the classes it compiled to
<div className={mergeClassNames("lead", panel)} />  // beside a class of your own
```

**This is what `RMD020` was about.** A block used to be `{ <what it sets>: <the class> }`, because
that was where *the thing set* was written down — and a map is an object, so a block written in the
markup was a new object on every render and a child receiving it re-rendered for nothing. The key is
in the class name now, so two merges with the same contents are the same value, compared the way
every other prop is compared. The one-slot cache that existed to paper over it is gone, and so is
the question.

What went with it:

- **`compose`** — it was the primitive `mergeClassNames` was the boundary of, and with strings they
  are one thing.
- **`block()` and `toStyleObject`** — a descriptor a call filled with a hole's values, and the
  `{ className, style }` a renderer with no `css` prop of its own spread. `className={panel}` is
  what that is now.
- **`StyleMap`, `StyleEntry`, `StyleBlock`, `HoleValues`, `StyleVarValue`** — the shapes of a value
  that carried values.
- In `@ramonda/core`: `applyCssBlock` and everything it did with custom properties, and the two
  runtime diagnostics about them, **`RMD062`** and **`RMD063`**. `RMD064` stays and says what a block
  is now.

**Two things a class string cannot carry, and each module registers what its own blocks need.** A
table of all 98 shorthand families is 23 KB, 3.7 KB gzipped — larger than this whole runtime, and a
page writing three shorthands would pay for ninety-five it does not. So a module registers the
shorthands it writes, which is what a `padding` needs to clear a caller's `padding-left`. It also
registers the conditions and property names the development order-warning reads, inside a
`process.env.NODE_ENV` guard a production bundler drops.

**The `;` rule moved with its hazard.** A value holding a `;` becomes a second declaration when a
server-rendered `style` attribute is parsed back out of HTML — measured, `red; position: fixed;
width: 100vw` came out applied. That was `toStyleObject`'s and the framework's; a block sets nothing
on an element now, and `toStyle` is how a value reaches one, so it is `toStyle` that refuses it.

**A class this compiler did not write keys on itself**, which matters because
`mergeClassNames("lead", @@( … ))` is how a block sits beside a class of your own. `keyIn` reads a
key out of OUR spelling, and on a name that is not ours it reads letters — measured, `lead` and
`head` both come to `ad`, so one would have displaced the other, and a class literally named `pl`
was cleared by a `padding` beside it. A foreign class is keyed behind a space, which no key of ours
can hold.

`scripts/check-css-contract.mjs` is gone with the shape it compared: both packages say `string`.
