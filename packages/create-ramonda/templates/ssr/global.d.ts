// `h` is injected into every module by esbuild (see jsx-shim.ts), so it is a
// runtime global. This tells TypeScript it exists without importing it by hand.
import { h as _h } from "@ramonda/core";

declare global {
  const h: typeof _h;
  // Replaced by esbuild's `--define` per build: true for `dev`, false for `build`. The
  // devtools import is behind it, so a production bundle never carries the panel.
  const __DEV__: boolean;
}
