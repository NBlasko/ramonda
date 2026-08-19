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
// The SSR template has no equivalent, and the reason is CSS: it imports none. It DOES have
// `import.meta.env` — `@ramonda/build`'s esbuild half defines the object and every `RAMONDA_PUBLIC_`
// name, so `import.meta.env.DEV` and `import.meta.env.RAMONDA_PUBLIC_…` read the same on both sides.
// It types them in `global.d.ts` rather than here, because it has no Vite types to reference.
