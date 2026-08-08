---
"create-ramonda": patch
---

A scaffolded SPA type-checks before it is touched

A fresh project reported two errors in the file the scaffolder wrote itself:

```
src/main.tsx  Cannot find module './style.css'
src/main.tsx  Property 'env' does not exist on type 'ImportMeta'
```

The code was right — Vite injects both — and only the types were missing. The second is the sharper
one, because the scaffolder GENERATES that line: the devtools panel is imported behind
`if (import.meta.env.DEV)`, so every SPA shipped with a type error in it.

The template now carries `src/vite-env.d.ts` with `/// <reference types="vite/client" />`, which is
one line and is where `npm create vite` puts it too. It declares `ImportMeta.env` and the `*.css`
modules, so a CSS-module import types its class names as well. Verified against a real scaffold:
`tsc --noEmit` fails without the file and passes with it.

SSR is unaffected and deliberately different — esbuild, `__DEV__` from its own `global.d.ts`, no CSS.
