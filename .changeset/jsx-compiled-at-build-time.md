---
"@ramonda/build": minor
---

JSX is compiled at build time

`ramonda()` — both the Vite and the esbuild plugin — now compiles each JSX tree of host elements into a
template, built once, and the values of its holes, which is all a render computes again. An element's
plain attributes go into the template; every attribute with a rule (a field's `value`, a listener, a
`ref`, a `style`, a boolean attribute), an element's `{…}` child and children that mix text, values and
components are holes, written by the same rules as before. Components, fragments, spreads, a `class`
attribute and text with an entity are left to the JSX transform as they were, and a host element inside
them is compiled on its own. `ramonda({ compile: false })` builds the app the way it was built before.
