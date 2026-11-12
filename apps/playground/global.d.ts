/// <reference types="vite/client" />
// Only `__DEV__`. The JSX factory used to be declared globally too, by core; with the
// automatic runtime the compiler imports it per file and there is no global to declare.
declare global {
  // Build-time flag, replaced by the bundler's `define`.
  const __DEV__: boolean;
}

export {};
