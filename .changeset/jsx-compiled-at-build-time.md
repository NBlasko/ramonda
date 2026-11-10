---
"@ramonda/build": minor
---

JSX is compiled at build time

`ramonda()` — both the Vite and the esbuild plugin — now compiles each JSX tree of host elements into a
template, built once, and the values of its holes, which is all a render computes again. An element's
plain attributes go into the template; every attribute with a rule (a field's `value`, a listener, a
`ref`, a `style`, a boolean attribute), an element's `{…}` child and children that mix text, values and
components are holes, written by the same rules as before. Components, fragments, spreads, a `class`
attribute and text or an attribute with an entity are left to the JSX transform as they were, and a host
element inside them is compiled on its own. Every expression keeps its place in the source, so a stack
trace or a breakpoint inside a handler written in JSX points at the line it was written on. `ramonda({ compile: false })` builds the app the way it was built before.

On Vite, `ramonda()` returns two plugins — its settings, and the compiler, `ramonda:compile`, which
compiles the source Vite read, inside `server.fs.allow`, before every other transform. `plugins: [ramonda()]`
holds both. An element written where the module is evaluated — an icon kept in a constant — is made there,
with calls a bundler may leave out, so one that nothing imports is not in the bundle.
