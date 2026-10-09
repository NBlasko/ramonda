---
"create-ramonda": minor
---

**A new project's build checks the types.** Vite and esbuild strip types without reading them, so
the build of a scaffolded project shipped a type error in silence — measured: `export const x:
number = "a string"` built green in both templates. `npm run build` now runs `npm run typecheck`
second, after `ramonda-check`; it is `tsc --noEmit`, and the style-blocks setup page says to make it
`ramonda-css` once a file holds a block, because `tsc` cannot read one.
