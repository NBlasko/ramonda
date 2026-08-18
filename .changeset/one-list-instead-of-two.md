---
"@ramonda/core": patch
"@ramonda/check": patch
---

`@ramonda/dom-facts` — one list of SVG tags instead of two.

`@ramonda/core` decides how to build an element; `@ramonda/check` reads source and says what that
decision will be. Both need the same list of tags, and both had one. Written into the checker as a
first guess, its copy was **twenty-one tags short** — every filter primitive — and wrongly claimed
`title`, which the framework renders as HTML. A test that read core's source caught it, but a test
pinning two lists together is a confession that there are two lists.

So there is one, in a **private** package that publishes nothing and is a devDependency of both.
Both consumers bundle their own code and tsup inlines anything that is not a declared `dependency`,
so nothing about either published package changes:

- `@ramonda/core` ships the identical literal — 636 bytes, byte-for-byte — in the same chunk. Total
  production output moved by **six bytes** raw and **one byte less** gzipped, all of it the
  minifier renaming a variable because module order shifted. No import and no type in `dist`
  mentions the private package; only the dev bundle's path comment does, which is how esbuild marks
  an inlined module.
- `@ramonda/check` still publishes with **no runtime dependency at all**, which is the property that
  lets it run first in a build. The list is inlined into its shared chunk.

`svgElements` is still exported from core's `constants.ts`, as a re-export, so nothing inside core
changed an import and `SvgNamespace.test.tsx` still pins the list to the SVG types in `global.ts`.

The package has a rule about what may go in it, written at the top: a fact about the DOM or HTML
that **both** packages need, and nothing else. A shared package with no such rule becomes the place
things go to avoid a decision.
