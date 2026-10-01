---
"@ramonda/css": minor
---

New rule `root-in-a-block`: `:root { … }` or `html { … }` inside a block is refused. A block is one
element's rule, so it meant the root under the element, which nothing is — it compiled and applied
nowhere. `:root.dark & { … }`, the element under the root, is unaffected.
