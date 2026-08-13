# @ramonda/build

## 0.1.0

### Minor Changes

- e2e1943: New package: `@ramonda/build`, which owns the transform settings so an app names none of them.

  Three settings decide whether a Ramonda app runs — `jsx`, `jsxImportSource` and `target` — and they
  have to agree with each other, with the app's tsconfig, and in every place the app runs a transform.
  `target` is the one nobody would guess: `@state` and the rest are TC39 decorators, no engine can
  parse them, and esbuild compiles them away for every target except `esnext`, which is its default.
  A build configured wrongly succeeds, warns about nothing, and dies on the first page load.

  ```ts
  // vite.config.ts
  import { ramonda } from "@ramonda/build/vite";
  export default defineConfig({ plugins: [ramonda()] });
  ```

  ```ts
  // an esbuild build of your own
  import { ramondaOptions } from "@ramonda/build/esbuild";
  await build({
    ...ramondaOptions,
    entryPoints: ["src/entry-client.tsx"],
    bundle: true,
  });
  ```

  A `target` that would leave the decorators in is **refused**, not overridden — Vite merges a
  plugin's config over the user's, so this could win silently, and a setting that gets quietly
  reversed is one you cannot reason about. A target that already works is left alone.

  Scaffolded projects take it in both modes: the SPA config and the SSR dev server use the Vite
  plugin, and the SSR production build is now `scripts/build.mjs` spreading `ramondaOptions` in place
  of the `build:client` / `build:server` command lines, which had the three flags written out twice.
