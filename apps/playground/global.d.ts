/// <reference types="vite/client" />
// `h` is already declared globally by core's `global.ts`, which this app pulls in via
// `export * from "./global"` — re-declaring it here collided with that declaration, and
// left `__DEV__` undeclared, so type-checking this app reported every `if (__DEV__)` in
// core's source as an unknown name. `playground-core`'s file has been the correct one all
// along; this is the same.
declare global {
  // Build-time flag, replaced by the bundler's `define`.
  const __DEV__: boolean;
}

export {};
