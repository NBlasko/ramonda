---
"@ramonda/css": minor
---

**`Value<"…">` is what an element takes: a string.** A value made outside a block goes onto an
element — a `style` object or a registered property's value — and every value there is a string.
`Value` was built from the block's shape, which holds `0` and a project's numeric list as numbers,
so `style={{ [space]: props.gap }}` with `gap: Value<"gap">` did not type-check. A number is now
written as text: `Value<"z-index">` with `values: [1, 2, 5, 10]` is `"1" | "2" | "5" | "10"`.
Minor, because a number assigned to a `Value` must now be a string. Run `ramonda-css codegen` to
update `css-system`.

The page on writing blocks says where such a value goes — a prop, or a value code chooses — and that
inside a block you never need it.
