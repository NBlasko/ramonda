---
"create-ramonda": minor
---

Four things a fresh project needed, all found by actually running the scaffolder against the
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
