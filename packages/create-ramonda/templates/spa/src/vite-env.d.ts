/// <reference types="vite/client" />

// Two things a Vite project needs TypeScript to know, and neither is guessable from the source:
//
//   import "./style.css";        // what a `.css` module IS
//   if (import.meta.env.DEV) {}  // that `import.meta` has an `env` at all
//
// Vite injects both at build time, so the code is correct and only the TYPES were missing — a
// fresh project reported "Cannot find module './style.css'" and "Property 'env' does not exist on
// type 'ImportMeta'" before it had been touched. This one line is the whole fix, and it is where
// `npm create vite` puts it too.
//
// The SSR template has no equivalent: it is built by esbuild, `__DEV__` is a `--define` declared in
// its own `global.d.ts`, and it imports no CSS.
