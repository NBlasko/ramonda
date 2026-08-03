// `__ramondaH` is the JSX factory, injected into every module by esbuild (see jsx-shim.ts), so
// no .tsx file imports it by hand. This tells TypeScript it exists.
//
// The name is deliberately unusable: a factory called `h` is a name someone will reuse, and a
// binding named `h` anywhere in a file wins over the injected one — a bundler only injects an
// identifier that is not already bound. A module-level `function h()` then makes every `<div/>`
// in that file call YOUR function, with no error at all.
import { h as _h } from "@ramonda/core";

declare global {
  const __ramondaH: typeof _h;
  // Replaced by esbuild's `--define` per build: true for `dev`, false for `build`. The
  // devtools import is behind it, so a production bundle never carries the panel.
  const __DEV__: boolean;
}
