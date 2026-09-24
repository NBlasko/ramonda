---
"@ramonda/css": minor
---

**`state-is-a-tuple` — a state in an allow-list written `[{ … }]` is reported.** A nested rule in a
style prop's allow-list is a LIST of declarations, and a one-element tuple constrains only the first
of them.

```diff
 type CardStyle = {
   color?: Var<"color">;
-  "&:hover"?: [{ color?: Var<"color"> }];
+  "&:hover"?: { color?: Var<"color"> }[];
 };
```

**The fault is silent, which is why it needs a rule rather than a line in the docs.** The tuple
type-checks, the build passes, and the slot keeps working — for the first declaration inside the
state. Everything under that one is accepted whatever it sets, and the caller who writes a property
the component never offered is told nothing.

Measured on this repository's own playground, the same `float: left` inside a `Chip`'s `&:hover`:

| position in the state | |
|---|---|
| first declaration | `TS2353` |
| second | **silent** |

A block compiles to one object literal per declaration, and a one-element tuple gives element 0 a
contextual type and nothing else. `{ … }[]` gives every element one. Nothing else changes: the
compiler already emits an array, and `CssBlockShape` already says `CssBlockShape[]`.

The spelling this package shipped and documented was the tuple. It is corrected on
[the reader page](/style-blocks/prop), in the playground, and in the design record.

A tuple of more than one element is left alone — measured, every element has a contextual type
there, so the slot does hold.

**And the key is what decides whether a type is an allow-list at all.** A `&` has to continue as a
selector does and an `@` has to name an at-rule that may nest, so a JSON-LD `"@type"` and a `"&ref"`
of your own are not touched. The element cannot carry that test: of 34 ordinary field names tried —
`x`, `y`, `content`, `order`, `filter`, `all`, `width`, `color` — all 34 are also CSS property
names.
