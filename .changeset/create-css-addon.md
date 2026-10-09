---
"create-ramonda": minor
---

**`@ramonda/css` is an add-on, and on by default.** A new project's page is written in style
blocks, under a `ramonda.css.ts` that starts strict: every colour and every length comes from a
token it declares — light and dark from one `light-dark()` pair each — no custom property is made up
on the spot, and a block styles only its own element. Shorthands are allowed: the compiler keeps
CSS's order through them, measured with tokens in both directions. The type check runs
`ramonda-css`, which reads blocks.
