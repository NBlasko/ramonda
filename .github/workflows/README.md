# CI/CD workflows

Four workflows, plus a shared setup action. They are deliberately small — a
foundation of best practices to grow from, not an all-in-one.

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR to `main`, push to `main` | Lint + format, type-check, test, build — via `checks.yml` |
| `checks.yml` | *reusable* (`workflow_call`) | The one gate: parallel lint+format / type-check / test / build |
| `release.yml` | push to `main` | Changesets: opens a "Version Packages" PR, or publishes to npm |
| `deploy-docs.yml` | push to `main` (prod), PR to `main` (preview) | Builds `apps/docs` and deploys to Cloudflare Pages |

The shared `.github/actions/setup` composite installs pnpm (from the root
`packageManager` field), Node 20, and dependencies with `--frozen-lockfile`.

## Running the gate locally: `pnpm check`

```
pnpm check      # pnpm lint && pnpm format:check && turbo run check-types test build
```

It exists because **`turbo run` alone is not the gate.** Two of the four checks are
root scripts that turbo never sees:

- `pnpm lint` is one oxlint pass over the **whole** repo. No app under `apps/` has a
  `lint` script, so `turbo run lint` covers `packages/` only — a lint error in a
  playground or in the docs app is invisible to turbo and fatal in CI.
- `pnpm format:check` is not a turbo task at all.

A branch was once "green" on `turbo run check-types test build` while carrying a
sparse array in `apps/playground-ssr/server.mjs` and a misformatted file in
`apps/playground-core` — both committed, both would have failed `ci.yml`. Verify with
`pnpm check`, which runs what CI runs, in the same order.

## Code style: oxlint + biome

Two tools, one job each:

- **oxlint** is the **linter** (`pnpm lint`, config `.oxlintrc.json`). One fast
  pass over the whole monorepo. Rules that fight this codebase's intentional
  patterns are turned off with rationale: `no-underscore-dangle` (the framework
  uses `__DEV__` / `_component*`), `no-this-alias` (decorator initializers alias
  `this`), `unicorn/no-useless-spread` (spread-to-snapshot before mutating a set),
  `unicorn/no-new-array` (preallocation in the hot diff path). It runs
  `correctness` as errors; expand categories later.
- **biome** is the **formatter only** (`pnpm format` / `pnpm format:check`,
  config `biome.json`, 2-space, width 120). Its linter is disabled so it never
  overlaps oxlint, and `vcs.useIgnoreFile` scopes it to tracked files (it no
  longer scans `dist/` or generated output).

Both are hard gates in CI. There is no ESLint (there never was a config).

## Required secrets

Set these under **Settings → Secrets and variables → Actions**.

| Secret | Used by | Notes |
|---|---|---|
| `NPM_TOKEN` | `release.yml` | npm **Automation** access token with publish rights for the `@ramonda` scope. |
| `CLOUDFLARE_API_TOKEN` | `deploy-docs.yml` | Custom token with **Account → Cloudflare Pages → Edit**. |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-docs.yml` | Your Cloudflare account id (in the dashboard URL). |

`GITHUB_TOKEN` is provided automatically; no setup needed.

## One-time setup

- **Cloudflare Pages project.** The workflow uploads a *prebuilt* site (Direct
  Upload) — Cloudflare runs no build, so there is no pnpm/monorepo build config to
  fight, and the pagefind step stays in GitHub Actions where it already works.
  One-time, in the Cloudflare dashboard:
  1. **Workers & Pages → Create → Pages → Direct Upload.** Name it **`ramonda`** —
     that name *is* the subdomain, `ramonda.pages.dev`. (To use another name, edit
     `--project-name` in `deploy-docs.yml`.) You can create it empty; the first
     workflow run fills it.
  2. **Production branch = `main`** (project → Settings). A deploy on `main` is
     production; any other branch gets its own preview URL.
  3. **API token:** My Profile → API Tokens → Create Token → *Custom token*, with
     **Account → Cloudflare Pages → Edit**. Store it as the `CLOUDFLARE_API_TOKEN`
     secret.
  4. **Account ID:** in the dashboard URL (`dash.cloudflare.com/<account-id>`) or on
     any Workers & Pages page. Store it as `CLOUDFLARE_ACCOUNT_ID`.

  PR deploys post their preview URL back on the PR. Attach a custom domain later
  under the project's **Custom domains** tab — no workflow change needed.
- **npm provenance.** `release.yml` publishes with provenance (via the
  `NPM_CONFIG_PROVENANCE` env var, honored by the underlying publish), which needs
  `id-token: write` (already set) **and a public repository**. If this repo is
  private, drop the `NPM_CONFIG_PROVENANCE` line from `release.yml`.
- **`npm` environment (optional).** Create an environment named `npm` and add
  required reviewers to make every publish a manual approval; scope `NPM_TOKEN`
  to it for tighter blast radius.

## How a release works (Changesets)

Versions and changelogs are driven by [Changesets](https://github.com/changesets/changesets)
(config in `.changeset/`). A PR **drives** the release:

1. **In your PR**, if you changed a package, add a changeset: `pnpm changeset` —
   pick the packages, pick patch/minor/major, write a changelog line. Commit the
   file it creates. (No user-facing change? No changeset needed.)
2. **On merge to `main`**, `release.yml` runs the `changesets/action`:
   - if changesets are pending, it opens/updates a **"Version Packages"** PR that
     bumps versions and rewrites each `CHANGELOG.md`;
   - if none are pending (that PR was just merged), it runs `pnpm release`, which
     **builds and `changeset publish`es** to npm.
3. `changeset publish` skips versions already on npm, rewrites `workspace:*` to
   real versions, and tags each release. Private packages (`apps/*`,
   `@ramonda/shared`) are ignored.

**The very first publish** needed no changeset: the packages were not on npm yet,
so merging to `main` published them at the versions they already carried. Every
bump since comes from a changeset.

`CHANGELOG`s link back to PRs and authors via `@changesets/changelog-github`,
which reads `GITHUB_TOKEN` — already provided in CI. (Running `pnpm changeset
version` locally would need a `GITHUB_TOKEN` in your env; normally you let the
Version PR do it.)

## What passes today (measured)

The gate was run locally before these workflows were committed:

- **Build** — green across every package and app (including the docs
  prerender + pagefind pipeline).
- **Type-check** — green (core, router, lens, testing-library, docs). core runs
  `strict` plus `noUnusedLocals` / `noUnusedParameters` / `noImplicitOverride` /
  `noFallthroughCasesInSwitch`.
- **Test** — green: 10/10 task runs, once the two scratch apps are excluded (see
  below). core, router, lens, testing-library and devtools all pass.
- **Lint** — **green and blocking** (oxlint). 0 errors across the monorepo; one
  accepted warning remains (an unused type parameter in `HookTypes.ts`, left for
  the types pass because fixing it touches core's declared type surface).
- **Format** — **green and blocking** (biome). All 303 tracked files are
  formatted; adopting the formatter reflowed 195 of them (2-space, width 120),
  a behavior-preserving change confirmed by the tests above.

The `test` job excludes `playground` and `playground-core`: their `test` script
is still the `npm init` placeholder that exits 1. Give them a real (or empty)
test script and drop the `--filter` flags in `checks.yml`.

## Pinned dev dependencies (do not blindly bump)

Three dev/build-time deps are deliberately held back. **None of them affect the
published packages** (those ship via tsup/esbuild; consumers bring their own
TypeScript). Each latest major breaks the setup for no shipped benefit — revisit
only with the fix in hand:

- **`vite` held at `^7`.** Vite 8 switched to the oxc transformer, which ignores
  the `esbuild: { jsxFactory: "h" }` block the vitest configs use, so JSX stops
  compiling in tests (`SyntaxError`). To move to 8, configure oxc's JSX pragma in
  every vitest config. (See the note in `packages/router/vitest.config.ts`.)
- **`jsdom` pinned to `28.0.0`.** 28.1+/29 changed CSSOM `cssText` serialization
  (a color keyword comes back as `rgb(...)`), which breaks the RMD007 style-
  normalization test and a test that spies on `cssText`.
- **`typescript` held at `^5.9`.** TS 7 (the native rewrite) removed `baseUrl`,
  which every tsconfig uses with `paths`, and tsup's `.d.ts` generation is not
  known to support it yet.

## Deliberate gaps (the "we'll add more later" list)

- **Stricter core types.** core now type-checks in CI under `strict` + the four
  cheap flags. Two heavier ones are deliberately deferred (measured counts): turn
  on `exactOptionalPropertyTypes` and clear its ~21 errors (mostly optional props
  explicitly set to `undefined` — a real undefined-vs-absent tightening worth
  doing on its own), and only then weigh `noUncheckedIndexedAccess` (~126, and
  often not worth it for framework-internal indexing with known bounds).
- **Expand oxlint categories.** Only `correctness` is enabled as errors today.
  `suspicious` / `perf` / `style` catch more but need a tuning pass first (they
  surfaced ~228 mostly-stylistic warnings on the initial run). Add them as
  warnings, clear, then promote.
- **Turbo remote caching.** Add `TURBO_TOKEN` / `TURBO_TEAM` to share the build
  cache across runs and machines, so `test` and `build` stop rebuilding from
  scratch each job.
- **Node version matrix.** `engines` is `>=18`; CI runs Node 20. Add a matrix
  (e.g. 20 + 22) once the toolchain is proven on more than one.
