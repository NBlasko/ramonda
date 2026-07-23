---
title: Lazy loading
description: AsyncLoad defers a module until the component is first rendered.
section: Composition
order: 74
---

# Lazy loading

```tsx
<AsyncLoad
  lazy={() => import("./HeavyPanel")}
  namedExport="HeavyPanel"
  loadedProps={{ note: "hello" }}
  onLoading={<p>loading…</p>}
  errorFallback={({ error, retry }) => (
    <p>Could not load it. <button onClick={retry}>retry</button></p>
  )}
/>
```

```demo:LazyPanel
```

**That panel was rendered by the server.** Its timestamp is the build time, not this page load —
the prerender awaited the import, wrote the component into the HTML, and emitted a
`<link rel="modulepreload">` for its chunk. Your browser started fetching that chunk from its
first parse of `<head>`, in parallel with the main bundle, and hydration adopted the markup
rather than replacing it.

Toggle it to watch the module cache work: mounting it again needs no request at all.

## It is an ordinary component

Written as a tag like everything else, with the default host. There is no special syntax and no
compiler support involved — `lazy` is just a function returning a promise.

## `loadedProps`, not attributes

The loaded component's props go in `loadedProps`:

```tsx
<AsyncLoad lazy={…} loadedProps={{ userId: 42 }} … />
```

They belong to a **different component** and must not share this tag's attributes — otherwise
`onLoading` and `lazy` would be indistinguishable from props meant for the thing being loaded.

## `namedExport`

Defaults to the module's `default`. Pass `namedExport` for a named one, which is the common case
in a codebase that does not use default exports.

## Failure, and why `retry` really retries

`errorFallback` takes a node or a function. The function form gets `{ error, retry }` — the same
shape as [`ErrorBoundary`](/composition/error-boundaries)'s `fallback`.

`retry` genuinely re-attempts the import, and that is worth stating because the browser's
behaviour here is not obvious: **a failed dynamic `import()` is not memoized.** A second call for
the same specifier makes a real network request. (A *successful* one is cached, which is why the
demo above fetches once.)

That was measured rather than assumed — timing distinguishes the two, since a memoized rejection
comes back in a microtask while a real request has to reach the server.

## Unmounting while it is still loading

Safe. The component is torn down and the resolved module is dropped; nothing writes into a
component that is gone.

## On a prerendered page

Three things happen that are worth knowing about, because together they are what make a lazy
component costless on a static site.

**The server awaits the import.** `@mount` runs on the server — that is where an app fetches —
and `renderToString` waits for the promise it returns before serializing. So the loaded
component's markup is in the HTML, with its own state blob.

**Hydration does not destroy it.** The client's module cache is cold, so `AsyncLoad`'s first
render would produce `onLoading` — a structure mismatch that hydration normally resolves by
replacing the node. Instead it *defers*: the server's nodes are adopted untouched and hydrated
once the chunk arrives. The reader never sees finished content collapse into a spinner.

**`preload` removes the waterfall.**

```tsx
<AsyncLoad lazy={() => import("./Panel")} preload={manifest.Panel} … />
```

Without it, the chunk cannot even be *requested* until the main bundle has downloaded, parsed and
hydrated far enough to reach this component. With it, the browser starts fetching from its first
parse of `<head>`. Measured on this page:

```
  chunk-…js    requested at  21ms   ← the preload hint
  client.js    requested at  22ms
```

Both start together, instead of one waiting for the other.

The value has to come from your build's manifest — esbuild's `--metafile`, Vite's
`manifest.json`. Nothing at runtime knows it: the server resolves the import inside its own module
graph, and the browser fetches a hashed filename that only the bundler can name.

## Your bundler has to split

`AsyncLoad` defers the module; producing a separate chunk is your bundler's job. With esbuild that
means `--splitting --outdir=…` rather than `--outfile`; with Vite it is the default.

**This applies to the server build too**, and it is easy to miss. With `--outfile` and ESM,
esbuild cannot create a chunk, so it leaves `import("./Panel")` in the output as a literal runtime
import — which then fails to resolve relative to the build directory, and every lazy component
renders its error fallback into your HTML. Split both bundles.

## Next

- [Examples](/guide/examples) — every feature as a running component.
