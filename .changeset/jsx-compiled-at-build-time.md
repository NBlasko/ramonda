---
"@ramonda/build": minor
---

JSX is compiled at build time

`ramonda()` — both the Vite and the esbuild plugin — now compiles each JSX tree of host elements into a
template, built once, and the values of its holes, which is all a render computes again. An element's
plain attributes go into the template; every attribute with a rule (a field's `value`, a listener, a
`ref`, a `style`, a boolean attribute), an element's `{…}` child and children that mix text, values and
components are holes, written by the same rules as before. Components, fragments, spreads, namespaced
tags and attributes, a `class` or `children` attribute, a `key` below a tree's root, an element that writes
one attribute twice, a `__proto__` attribute, a `<this>` tag, text holding U+0085 or U+200B, and text or an
attribute with an `&` are left to the JSX transform as they were, and a host
element inside them is compiled on its own. Every expression keeps its place in the source, so a stack
trace or a breakpoint inside a handler written in JSX points at the line it was written on. In a development build each template also says where its elements
were written, so RMD020 names the file, line and column of a compiled element as it does any other. `ramonda({ compile: false })` builds the app the way it was built before.

On Vite, `ramonda()` returns two plugins — its settings, and the compiler, `ramonda:compile`, which
compiles the source Vite read, inside `server.fs.allow`, after `@ramonda/css`'s transform and before the
JSX transform. `plugins: [ramonda()]`
holds both. In development compiled modules import from `@ramonda/core/jsx-dev-runtime`, as the JSX transform's
own output does, so the dev server has pre-bundled what they need before the first page. Each JSX tree is its own template, so two branches of a condition are two elements, and
switching builds the other — one element with a changing attribute stays the same element. An element written where the module is evaluated — an icon kept in a constant — is made there,
with calls a bundler may leave out, so one that nothing imports is not in the bundle.
