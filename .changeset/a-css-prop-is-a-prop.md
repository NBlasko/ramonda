---
"@ramonda/core": patch
---

**`RMD020` sees a prop named `css` again.** The render-stability check exempted it by name, so the
one prop most likely to carry a block was the one never compared.

The exemption was right once: the framework had a `css` prop of its own, a block was a MAP, and the
value was generated per element, applied, and dropped — a fresh identity for it meant nothing to
anybody. None of that holds now. A block is a string, so it is not a fresh object at all, and `css`
is what a COMPONENT calls its own prop for the styles it accepts.

Measured with the identical value under two names:

| a fresh object on | before |
|---|---|
| a prop named `sx` | `RMD020` |
| a prop named `css` | silent |

It was the last `"css"` special case left in `@ramonda/core`. Its comment pointed at
`core/cssBlock.ts`, a file this release deletes, which is how it was found — and a docstring in
`helpers/constants.ts` describing a constant that went with that file is gone too.
