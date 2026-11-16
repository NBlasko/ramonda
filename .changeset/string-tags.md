---
"@ramonda/check": patch
---

A tag whose TYPE is a string is an element, not an unresolved component: `__h(node.t, …)` with the tag
read from a parsed tree, and `<Heading>` with `Heading` returned as `"h1" | "h2"`. Only the syntax was
read before, so the docs site's own code block carried a `ramonda-check-ignore` for a design that is
right. `any`, `unknown` and a union with a component still prove nothing and are reported.
