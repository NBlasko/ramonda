---
"@ramonda/css": patch
---

The style-prop page says where its types come from, and one thing it left out.

Every row of its *where a fault lands* table was put through a real project rather than trusted —
prose tables are the one part of a page no gate reads. Two things came back:

- **`Token` is exported from `@ramonda/css`, not from `@ramonda/css/properties`.** The page named it
  without saying where it comes from, and a reader following it would have imported from the wrong
  module. It says now, and it says that a project usually wants `Var<"color">` from its generated
  `css-system` instead — the same shape, one step tighter.
- **A narrowed value refuses `inherit`**, and `initial`, `unset` and `revert` with it. That is worth
  knowing before it is met, so the page says it and shows the union that keeps them.
