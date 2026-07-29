/// <reference types="vite/client" />
// `h` is already declared globally by core's `global.ts`, which this app pulls in
// via `export * from "./global"` — re-declaring it here collides with it.
declare global {
  // Build-time flag replaced by Vite's `define`.
  const __DEV__: boolean;
}

export {};
