# @ramonda/build

## 0.3.0

### Minor Changes

- a7a592a: Environment variables: `RAMONDA_PUBLIC_` reaches the browser, everything else stays on the server.

  An app configures none of it. The Vite plugin sets `envPrefix`, the esbuild half emits the `define`
  entries, and the convention lives in one place — which is what `@ramonda/build` is for.

  **Only the public half carries a prefix.** The prefix IS the decision to publish, so it has to be visible
  in the name; a secret must never be one keystroke in a `.env` away from shipping. The server half is left
  alone because `DATABASE_URL` comes from the host — Docker, Fly, a CI secret — and the app does not get to
  rename it. Read the server side with `process.env.WHATEVER`, and the public side with
  `import.meta.env.RAMONDA_PUBLIC_WHATEVER`.

  **Three measurements decided the shape, and two of them contradicted the plan.**

  - Vite's `envPrefix: "RAMONDA_PUBLIC_"` inlines the public value as a literal and leaves a non-public
    `RAMONDA_*` as `void 0`, with the value nowhere in the output. **But `envPrefix` REPLACES Vite's default
    rather than adding to it**, so `VITE_*` stops being exposed — in `build` and in `dev`. That is kept, not
    worked around: one convention is the point, and the app finds out from the build.
  - **esbuild leaves an undefined `import.meta.env.X` as a live reference and creates no `import.meta.env`,
    so the read throws in a browser.** So the esbuild half defines the object as the floor _and_ each public
    name for literal inlining. The floor object is the trap in the whole feature — `JSON.stringify(process.env)`
    there would ship every secret the build machine had, so only `publicEnv()` may go in, and a test asserts
    the secret's value is absent under either shape.
  - **No leak through the SSR dev server.** Vite injects `import.meta.env` with only the prefixed names plus
    its own `BASE_URL/DEV/MODE/PROD/SSR`.

  **What the review of this branch caught, and the first one was a real bug.** `envDefines`'s floor object
  held only the public names, so `import.meta.env.DEV/PROD/MODE/SSR/BASE_URL` compiled to `undefined` in every
  esbuild build — and `@ramonda/query` and `@ramonda/form` both document `if (import.meta.env.DEV) { void
import("…/devtools") }` as the one line an app writes. Measured: that guard became `if (undefined)` and the
  panel never loaded, in exactly the arrangement the SSR template uses (Vite in dev, esbuild in production).
  The floor now carries all five, each from something the build already said rather than a guess: `MODE` from
  `NODE_ENV`, `DEV`/`PROD` derived from it so they cannot disagree, `SSR` asked of the caller because only the
  caller knows (the plugin reads `platform === "node"`), and `BASE_URL` as `/`. All five are overridable.

  The review also found that `server-env-in-shared-code` reported a helper reached only from a server-only
  lifecycle — the shape its own advice recommends once the read is factored out, at error severity, with no
  `ramonda-check-ignore` available to class rules. A helper is now excused when EVERY reference to it in the
  class sits in an already-excused member, iterated to a fixed point so a helper may call a helper; a helper
  also called from `render()` is still reported, because an excuse has to hold for every caller. And
  `process.env` is now asked of `context.resolve`, so a file that SHIMS `process` for browser code is left
  alone — the shim is the fix, and `browser-url` draws the same distinction.

  **Verified end to end in a real app build, not only per piece.** `apps/playground-ssr` builds with esbuild
  through both `ramondaOptions` and the plugin; with `RAMONDA_PUBLIC_SMOKE` and `RAMONDA_SMOKE_SECRET` both
  set, the client bundle carries the public value (2 occurrences), carries **no trace of the secret**, and
  has **zero live `import.meta.env.NAME` reads** left — so nothing is waiting to throw in a browser. That app
  writes its own `define` after the spread, and the env entries survive because it also installs the plugin,
  which merges after the options are assembled. It is the case `ramondaDefine` exists for, seen from the
  other side.

  **`ramondaDefine` is a function, not a key on `ramondaOptions`, and that is a deliberate shape.** A spread
  cannot refuse anything: a build writing its own `define` after the spread — which every build does, because
  `__DEV__` lives there — would silently drop the env entries. A key that is lost by writing the obvious thing
  is worse than no key. The plugin form needs none of this; it merges after the options are assembled.

  **`envPrefix` set by the app is REFUSED, not merged**, in `config` and again in `configResolved` — because
  Vite merges a plugin's config over the app's, so quietly returning that key would expose a different set of
  variables than the app asked for, which is the one mistake here that cannot be walked back.

  **And a rule that catches the migration, because the migration is where this bites.**
  `unexposed-env-read` reports `import.meta.env.NAME` for any name nothing exposes — a `VITE_*` left over
  from before, a name with no prefix, or `RAMONDA_` without `PUBLIC`, which is the one that most reads as if
  it should already work. It suggests the name to use, stripping the old prefix rather than nesting it.

  And `server-env-in-shared-code` closes the other direction: `process.env` read from a member the browser
  also runs. `process` does not exist there, so it is a `ReferenceError` on the page rather than an
  `undefined` — and a dev server may shim enough of `process` to hide it until the production bundle. The
  asymmetry with `client-only-request-read`, which asks the opposite question of the same decorators, is that
  **"not marked" means "the browser gets here"**: `render()` runs on both sides, so does a field initialiser,
  and `@created`/`@mounted`/`@destroyed` default to `shared`. Only `{ env: "server" }` excuses a member — and
  a bare `@created()` is the easy mistake, because it looks server-ish. A read at module scope is not judged,
  since a server entry legitimately has one and whether a module reaches the client bundle is a question about
  imports. `CLIENT_ONLY_DECORATORS`, `LIFECYCLE_DECORATORS` and the two questions moved to
  `rules/lifecycle-env.ts` now that two rules share them.

  `unexposed-env-read` is a **warning**, not an error, and the reason is a premise it cannot verify: the name
  is never exposed IF the project uses `@ramonda/build`'s Vite plugin. A Ramonda app on plain Vite still
  exposes `VITE_*`, and `needs: "@ramonda/build"` cannot gate it — `needs` is decided from what the program
  imports, and the only file importing that package is `vite.config.ts`, which both scaffolded tsconfigs leave
  out of `include`. So the premise is stated in the message rather than enforced, and the run is not failed
  over it. Within its premise it is one of the few rules here that is genuinely COMPLETE: it asks nothing about where a value came from or whether one was set, only whether the NAME —
  written on the spot — is in the exposed set. That answer does not depend on an environment or a `.env`
  file, so there is no path it has to go quiet for. The exceptions are the bundler's own five names, a
  computed key, and a site carrying `ramonda-check-ignore`. Zero hits across `apps/docs`, both playgrounds,
  form and query — and zero for `server-env-in-shared-code` across the same six.

  New: `PUBLIC_ENV_PREFIX` and `publicEnv(env)` from the main entry, `ramondaDefine(own?)` from
  `@ramonda/build/esbuild`. The `create-ramonda` SSR template's build script now calls `ramondaDefine`.
  Documented on `/reference/build`, including how to type the names your app reads so a typo fails the build.

## 0.2.1

### Patch Changes

- fbfdfab: The README's docs link pointed at `/reference/check`, which is a different package. `@ramonda/build`
  now has a reference page of its own — what it sets, both adapters, what it refuses and why, and the
  escape hatch for a bundler with no adapter here — and the link points at it.

  The package also has a public-surface test now, like the other packages: `settings.ts` exports seven
  names and only two are meant to leave the package, and until now nothing said so.

## 0.2.0

### Minor Changes

- 4f097b8: `ramonda-check-bundle` stops calling a correct build broken, and both packages declare Node 24.

  A `.js` file is a script or a module depending on the nearest `package.json`, and a bundler emits ES
  modules into `dist` whatever that file declares — so `"type": "commonjs"` beside ESM output is an
  ordinary arrangement. Read as a script, such a bundle "does not parse", and this tool reported it as
  the one fault it exists to find:

  ```
  [check-bundle] 1 of 1 emitted file(s) do not parse:
      SyntaxError: Cannot use import statement outside a module
  If these contain decorators, the build is not running a transform that strips them.
  ```

  Nothing was wrong with the build. The guard failed it anyway, and named the wrong cause while doing
  so. Every project in this repository sets `"type": "module"`, which is the only reason this was
  never seen here.

  A file that fails to parse as a script, **and fails with one of the four messages that mean
  module-only syntax**, is now parsed again as a module. The second parse never runs otherwise, so a
  decorator still fails both ways and no failure is downgraded — there is a test for exactly that,
  because a retry that accepted anything would buy the false pass back at full price.

  **Breaking:** both packages now declare `"engines": { "node": ">=24" }`, matching the repository
  root and `create-ramonda`. `pnpm` refuses an install that violates `engines` rather than warning, so
  this is a floor and not advice.

  The floor is a choice about the future, not a measurement: `node --check` reads ESM in an untyped
  `.js` on 20.19 and on 22.7+, but **not on 22.0 through 22.6**, where module detection had not landed
  yet — a range that is not monotone, so `>=20.19` would have been a wrong description of it. Rather
  than encode that shape, the supported version is the one that will be current by the time anyone
  adopts this. The parse fix stands on its own regardless: `npm` only warns on `engines`, so the floor
  alone would have left the false accusation reachable.

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
