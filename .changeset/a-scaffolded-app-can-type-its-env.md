---
"create-ramonda": patch
---

The SSR template types `import.meta.env`, and a comment that my own change made false is corrected.

The SPA template gets `import.meta.env`'s type from `/// <reference types="vite/client" />`. The SSR
template has no Vite types to reference, so it now declares `ImportMetaEnv` and `ImportMeta` in its
`global.d.ts` — which is already in its `include`, so the declaration is actually compiled. That is the
file to add your own `RAMONDA_PUBLIC_` names to.

**And a comment that stopped being true.** `spa/src/vite-env.d.ts` explained the asymmetry between the two
templates as "the SSR template is built by esbuild" — which was the reason it had no `import.meta.env` at
all. It has one now, because `@ramonda/build`'s esbuild half defines the object and every public name. The
only asymmetry left is CSS, and the comment says so.

`global.d.ts` also says what `__DEV__` is for, which it did not: it is what `@ramonda/core` itself is
compiled against, which is why the build defines it. For an app's own code `import.meta.env.DEV` says the
same thing, is what the documentation uses, and reads alike under Vite in development and esbuild in
production — either is a literal at build time, so either compiles a development-only branch out.
