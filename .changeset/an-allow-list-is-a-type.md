---
"@ramonda/css": minor
---

**`allow-list-is-an-interface` — an `interface` handed to `CssBlock` is reported in those words.**

```diff
-export interface CardStyle { color?: Var<"color"> }
+export type CardStyle = { color?: Var<"color"> };
```

TypeScript gives an interface no implicit index signature, so it satisfies no shape built out of
one — and a block shape is. Measured: refused with the correct array spelling, refused with no state
at all, and the identical `type` beside it clean. There is nothing to fix inside the interface.

**This is the first rule here that REPLACES a compiler diagnostic instead of speaking past it.**
`TS2344` already reports the fault, as *Type `CardStyle` is not assignable to type
`{ [nested: \`&${string}\`]: CssBlockShape[] }`* — an index signature the author never wrote, and it
never says the word `interface`. So the one word that fixes it is the one word missing, and a reader
goes looking inside the interface where there is nothing to find.

The rule is reported on the same node the compiler used, and the `TS2344` there is dropped — in the
build and in the editor, on both of the editor's paths. The path that matters is the one for a file
with no block in it, which is what a file declaring a component's props usually is.
