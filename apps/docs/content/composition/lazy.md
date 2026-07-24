---
title: Lazy loading
description: Load a heavy component only when it is first shown, so the page starts light.
section: Composition
order: 54
---

# Lazy loading

A big component you don't need right away — a chart, a rich editor, a rarely-opened
dialog — doesn't have to be in your first download. `AsyncLoad` loads it only when it
is first rendered, so the page starts light.

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

It is an ordinary component written as a tag — `lazy` is just a function that returns
a promise (a dynamic `import()`), and `onLoading` is what to show until it arrives.

## The pieces

- **`lazy`** — a function returning `import("…")`.
- **`namedExport`** — which export to use; defaults to the module's `default`.
- **`loadedProps`** — the props for the component being loaded. They go here, kept
  apart from `AsyncLoad`'s own attributes (`lazy`, `onLoading`) so the two can't be
  confused.
- **`onLoading`** — shown while the module downloads.
- **`errorFallback`** — a node, or a function given `{ error, retry }` (the same shape
  as [`ErrorBoundary`](/composition/error-boundaries)). `retry` really does re-attempt
  the download.

Unmounting while it is still loading is safe — nothing gets written into a component
that is gone.

## Your bundler has to split the code (important)

`AsyncLoad` defers the module; producing a separate downloadable chunk is your
**bundler's** job. With Vite that is automatic. With esbuild, use
`--splitting --outdir=…` (not `--outfile`) — and for the **server build too**, or the
lazy import is left in the output and fails to load.

On a prerendered page the server can even render a lazy component straight into the
HTML, and a `preload` hint lets its chunk download in parallel with the main bundle.
Those details live with [server rendering](/ssr).

## Next

- [Examples](/examples) — every feature as a running component.
