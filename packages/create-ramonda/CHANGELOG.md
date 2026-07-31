# create-ramonda

## 0.2.0

### Minor Changes

- 4762997: The scaffolder requires Node 24, and refuses rather than warns.

  `engines` said `>=18`, which was never true: the SPA template pulls Vite 7, whose own floor is
  `^20.19 || >=22.12`. So a user on Node 18 got a project that installed and then failed to build, in a way
  that reads as Ramonda's fault rather than as a version mismatch.

  `engines` is advisory — npm prints a line and `npm create` proceeds — so the number alone cannot be the
  mechanism. The check now runs at the top of the CLI, **before anything is written**: it prints what is
  needed and what is running, and exits 1. Verified by running the built entry with `process.versions.node`
  patched to 22.9.0 — message shown, exit 1, no files created.

  Node 24 rather than the toolchain's actual floor, because it is the version this repo builds and tests on
  and `0.x` has nobody on old runtimes to keep faith with.

  The tests cover the boundary and assert that `engines` and the refusal agree, so the advisory and the
  mechanism cannot drift apart.

### Patch Changes

- ba9845c: A tagline that says what Ramonda is: **Explicit. Predictable. Readable.**

  The old one listed implementation choices — class components, signals, TC39 decorators — which is what a
  reader compares against their existing habits rather than a reason to look further. Nothing in it said
  what you get.

  Three words, in the order they cause each other: _explicit_ is how you write it, _predictable_ is how it
  runs, _readable_ is what you get back when you return to it a year later. No second sentence: the
  `Counter` example directly below is a better argument than an adjective defending an adjective.

  `keywords` in `package.json` still carries `signals`, `decorators`, `ssr` and the rest, so nothing was
  lost for npm search — those words moved to the field that search actually reads.

  Six places now agree: both READMEs, core's npm description, the docs social card, and both scaffolded
  apps. The SSR template keeps "Server-rendered, then hydrated", which is a fact about that app rather than
  the tagline.

## 0.1.0

### Minor Changes

- b9a7884: Four things a fresh project needed, all found by actually running the scaffolder against the
  published registry rather than the workspace.

  **The Query add-on now exists in the published CLI.** It was written and never released:
  `create-ramonda` had no changeset, so 0.0.4 shipped with `router`, `lens`, `devtools`,
  `testing` and `biome`, while `@ramonda/query` went out at 0.1.0 with nothing to install it.

  **The versions it pins are derived from the workspace at build time**, one range per package,
  instead of a hand-maintained constant. The constant said `~0.0.1` for everything, so a fresh
  project's first install failed outright — `No matching version found for
@ramonda/query@~0.0.1` — and it would have failed for router, lens and testing-library too,
  which are each on their own 0.0.x line. A single derived range was the first attempt at the
  fix; the release gate caught that within a minute.

  That gate now checks first-party ranges as well, against the WORKSPACE rather than the
  registry (a registry check would race the packages' own publish). It skipped them entirely
  before, with a sound reason that left the real hazard uncovered.

  **`pnpm install` works on pnpm 10 and 11.** Both refuse to run a dependency's build scripts
  until the project says which are allowed, and they exit non-zero when any were skipped —
  `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: esbuild@0.28.1`. esbuild's script is what
  puts its binary in place, so `pnpm dev` failed on every fresh project, in both templates (SSR
  depends on esbuild, the SPA gets it through vite). A generated `pnpm-workspace.yaml` allows
  it, carrying both spellings: `allowBuilds` for pnpm 11, `onlyBuiltDependencies` for pnpm 10.
  Verified against both.

  This monorepo could not have caught it: it pins `pnpm@9.0.0`, which has no such gate. And the
  scaffolder ran its install with `stdio: "ignore"`, so the reason was invisible — it now prints
  the failure's first useful line.

  **Development mode is development mode.** The SSR template built with
  `--conditions=production` for `dev` as well as `build`, so a scaffolded SSR app ran the
  production core: no diagnostics, no strict render, no devtools. `dev` now builds with
  `--conditions=development --define:__DEV__=true`, and `build` keeps production.

  **The devtools panel appears.** Core loads it through a dynamic import whose specifier is a
  variable marked `@vite-ignore` — deliberately, so `@ramonda/core` does not make
  `@ramonda/devtools` a resolution requirement for everyone — which means a bundler leaves the
  string alone, the browser fails to fetch it, and core's `.catch()` swallows that by design.
  The add-on installed a package nothing imported. The entry file now imports it, guarded by
  `__DEV__` (esbuild) or `import.meta.env.DEV` (vite).

  Measured on a scaffolded SSR project, end to end: install exits 0 under pnpm 11, the dev
  bundle carries the panel and the diagnostics, the production bundle carries neither, and
  hydrating the dev bundle attaches `<ramonda-devtools>` with its badge.

- db73e0e: Every version the scaffolder writes now comes from the workspace, and the scaffolder has
  tests.

  **The build tools are derived like the framework packages already were.** `vitest`, `vite`,
  `jsdom`, `@types/node` from `packages/core`, `typescript` and `@biomejs/biome` from the root,
  `esbuild` from `apps/docs` — read at build time. They were hand-written constants, and one had
  drifted a whole major: the template pinned `vitest@^3.2.4` while core, testing-library and the
  docs app were all on `^4.1.10`, so a generated project tested against a version the framework
  does not use. Exact pins are widened to a caret, because this repo pins some tools exactly for
  a reproducible lockfile and a generated project does not want that.

  **`vite` is installed with the testing add-on**, because it is a PEER dependency of vitest
  (`^6 || ^7 || ^8`). Without it vitest has no transform: measured on a scaffolded SSR project,
  the `.tsx` reached the runtime unchanged and the suite died with `SyntaxError: Invalid or
unexpected token` and `0 test`. The SPA template had vite already, which is why only SSR was
  broken — and why the bug survived the fix for the vitest version.

  **Twelve tests, none of which need a network or an install.** They check the built CLI rather
  than the source, because the ranges are injected at build time — the source cannot tell you
  what a user would get. Each case stands for a defect that shipped: one range for all
  first-party packages, a tilde where a caret would pin a single patch, a missing vitest peer,
  the `pnpm-workspace.yaml` with both spellings of the build-approval key, the absence of the
  `pnpm` field in package.json (pnpm 11 ignores it), the devtools import with the right guard per
  template, and the SSR template's development/production build split.

  Type-checking a scaffolded project is deliberately NOT among them: it needs a real install to
  resolve `@ramonda/*` and `vitest`, and a symlink to this workspace's `node_modules` does not
  provide those under pnpm's isolated layout. That belongs to the end-to-end pass, which is now
  written down as a skill (`.claude/skills/update-dependencies`) — including the part no unit
  test can do: scaffolding a project and running it with pnpm 10 and 11, since this repo pins
  pnpm 9, whose behaviour is not the one users get.

## 0.0.4

### Patch Changes

- 7b530bb: Add an optional **Biome** choice to the scaffolder — one tool for both linting and
  formatting.

  Picking it drops a `biome.json` (recommended lint rules via Biome 2.x's `preset`,
  2-space / 120-column formatter, git-ignore aware) into the project, adds
  `@biomejs/biome` as a dev dependency, and wires up `lint` (`biome lint .`) and
  `format` (`biome format --write .`) scripts. Both templates ship already formatted the
  way the config expects, so a fresh project is clean on the first run — `format` reports
  no changes and `lint` passes.

- 7b530bb: The SSR template now handles server-side redirects, and `@ramonda/*` are pinned so
  scaffolds can actually pick up new releases.

  - The generated `entry-server` catches `ServerRedirect` and hands `server.mjs` a
    plain `{ redirect }`, which answers with a 302 — so a route guard added to a
    scaffolded SSR app works on the first load, not just after hydration.
  - `@ramonda/*` dependencies switch from `^0.0.1` to `~0.0.1`. On a `0.0.z` version
    the caret pins to that exact patch, so scaffolds were frozen at 0.0.1 and could
    never install a newer framework — including the release that adds the redirect API
    the template above uses. The tilde (`>=0.0.1 <0.1.0`) lets a scaffold take the
    latest 0.0.x while the scaffolder still gates the 0.1 / 1.0 line itself.

## 0.0.3

### Patch Changes

- Scaffolded apps now show the rotating Ramonda flower (an inline SVG whose petals inherit the accent colour) instead of a placeholder dot — in both the SPA and SSR templates. Also fix the Testing add-on's generated test: it called `render(App)` instead of `render(<App />)`, which was a type error.

## 0.0.2

### Patch Changes

- Fix the CLI doing nothing when run via `npm create ramonda` / `npx create-ramonda`. The "invoked as CLI" guard compared `process.argv[1]` (the `node_modules/.bin` symlink npm runs the bin through) against `import.meta.url` (the real file), so they never matched and `main()` never ran. Compare resolved real paths instead.
