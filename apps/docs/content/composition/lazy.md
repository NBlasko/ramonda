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
// Beside the component, not in the render: an `import()` inside a thunk does not run until the
// thunk is called, so hoisting it costs nothing and gives the prop one identity for the module's
// life. Written in the markup it is a new function every render — see `function-built-in-the-markup`.
const loadHeavyPanel = () => import("./HeavyPanel");
const PANEL_PROPS = { note: "hello" };

class Report extends Component {
  loadFailed({ retry }: AsyncLoadFailure) {
    return (
      <p>
        Could not load it. <button onclick={retry}>retry</button>
      </p>
    );
  }

  render() {
    return (
      <AsyncLoad
        lazy={loadHeavyPanel}
        namedExport="HeavyPanel"
        loadedProps={PANEL_PROPS}
        onLoading={<p>loading…</p>}
        errorFallback={this.loadFailed}
      />
    );
  }
}
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
- **`errorFallback`** — a node, or a function given `{ error, retry, attempt }`. It
  plays the same role as an [`ErrorBoundary`](/composition/error-boundaries) fallback —
  a failure UI with a way back — though the fields are named for a *load*: `error` is
  whatever the import rejected with, `retry` really does re-attempt the download, and
  `attempt` counts the tries (`1` on the first failure).

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

## Two lazies that look the same

The loaded module is cached, and the cache key defaults to the SOURCE of the `lazy`
function — right for the usual `() => import("./Thing")`, because two different
imports read differently. A factory breaks that:

```tsx expect-error
const make = (path: string) => () => import(path);

<AsyncLoad lazy={make("./Dashboard")} onLoading={<i />} errorFallback={<i />} />
<AsyncLoad lazy={make("./Settings")} onLoading={<i />} errorFallback={<i />} />
```

Both functions stringify to `() => import(path)` — the value each closed over is not
part of the source — so they share one cache entry. The first module loads and the
second never even asks for its own: it reads the entry the first one filled and
renders `Dashboard` where `Settings` was written. Nothing fails, and nothing is
logged.

Give them their own identity when the lazy is built rather than written:

```tsx
<AsyncLoad cacheKey="./Dashboard" lazy={make("./Dashboard")} onLoading={<i />} errorFallback={<i />} />
<AsyncLoad cacheKey="./Settings" lazy={make("./Settings")} onLoading={<i />} errorFallback={<i />} />
```

The same applies to a route table that builds its lazies from a list — which is the
common way to meet this.

## Next

- [Examples](/examples) — every feature as a running component.
