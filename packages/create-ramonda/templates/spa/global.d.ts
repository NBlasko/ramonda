// `h` is injected into every module by Vite (see vite.config.ts), so it is a
// runtime global. This tells TypeScript it exists without importing it by hand.
import { h as _h } from "@ramonda/core";

declare global {
  const h: typeof _h;
}
