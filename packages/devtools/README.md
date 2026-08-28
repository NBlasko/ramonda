# @ramonda/devtools

The development panel for [Ramonda](https://ramonda.dev): the component tree with its state, props
and hooks, and a way to get from something on screen to the component that drew it.

[![npm](https://img.shields.io/npm/v/%40ramonda%2Fdevtools)](https://www.npmjs.com/package/@ramonda/devtools)
[![license](https://img.shields.io/npm/l/%40ramonda%2Fdevtools)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

> **Status: `0.x`.** The API changes freely between releases while the design is
> being explored; from `1.0` the interfaces hold. See the
> [root README](https://github.com/NBlasko/ramonda#readme).

```bash
pnpm add -D @ramonda/devtools
```

```ts
// main.ts — anywhere before your app mounts
if (import.meta.env.DEV) await import("@ramonda/devtools");
```

The import registers a `<ramonda-devtools>` element and nothing else. A purple **R** appears in the
bottom-right corner; click it, or press `Alt+D`, to open the panel.

## That line is yours to write, and it cannot move into the framework

Core does try the import itself in a development build, with the specifier held in a variable — and
it has to be a variable, because a literal one breaks apps that do not use devtools at all:

| | a literal `import("@ramonda/devtools")` inside core |
| --- | --- |
| `vite build` | **fails** — *Rollup failed to resolve import "@ramonda/devtools"* |
| esbuild | bundles, and ships a bare specifier no browser can resolve |

A variable specifier is left alone by the bundler, which leaves the browser to resolve
`@ramonda/devtools` on its own — and it cannot. So only your app can load the panel: it is the one
that knows the package is installed, and its bundler is the one that can resolve it. **If you have
never seen the badge, that missing line is why.**

## What is in it

**The component tree**, with each component's state, props and nested hooks — components in purple,
hooks in green. Filtering by name keeps the ancestors of a match, so a result still reads as a tree
and you can see where the thing lives.

**Pick**, which is the reverse of searching and usually the faster one: click the crosshair, then
click the thing on the page, and the tree opens on the component that drew it.

**The query cache**, for anything `@ramonda/query` is holding — what is fresh, what is in flight,
and what a refetch would do.

**Diagnostics**, the same `RMD…` codes the framework reports in the console, collected where you can
read them in order rather than scrolling past them.

## Development only

The panel is a `devDependency` and is loaded behind your own `import.meta.env.DEV` check, so nothing
of it reaches a production bundle. It reads the framework's development-time diagnostics, which a
production build does not emit.

See the [devtools guide](https://ramonda.dev/devtools) for the panels in full, and
[finding a component](https://ramonda.dev/devtools#finding-a-component) for the three ways round the
tree.

## License

[MIT](../../LICENSE) © Nikola Blagojević
