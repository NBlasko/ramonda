# CI/CD workflows

Seven workflows, plus a shared setup action. They are deliberately small — a
foundation of best practices to grow from, not an all-in-one.

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | PR to `main`, push to `main` | Lint + format, type-check, test, build — via `checks.yml` |
| `checks.yml` | *reusable* (`workflow_call`) | The one gate: parallel lint+format / type-check / test / build |
| `release.yml` | push to `main` | Changesets: opens a "Version Packages" PR, or publishes to npm |
| `deploy-docs.yml` | **manual only**, `main` only | Builds `apps/docs` and deploys to Cloudflare Pages |
| `codeql.yml` | PR to `main`, push to `main`, weekly | CodeQL static analysis of the TypeScript (SAST) |
| `dependency-review.yml` | PR to `main` | Blocks a PR that adds a high/critical advisory or a copyleft licence |
| `scorecard.yml` | weekly, branch-protection change, or manual | OpenSSF Scorecard: supply-chain hygiene, graded |

The shared `.github/actions/setup` composite installs pnpm (from the root
`packageManager` field), Node from **`.nvmrc`**, and dependencies with
`--frozen-lockfile`. `release.yml` reads the same file, so the version is decided
in one place — it publishes, and a second pin there could drift.

## Running the gate locally: `pnpm check`

```
pnpm check      # preflight-node + frozen-lockfile install + check-workflows +
                # ramonda-check, then lint, format:check, turbo run check-types
                # test build, check-examples, check-side-effects, and finally
                # check-scaffold (ssr + spa)
```

`test` carries `--coverage`, so this also leaves an lcov report under each package —
`node scripts/merge-lcov.mjs` combines them and prints the repository total.

It exists because **`turbo run` alone is not the gate.** Several checks are root
scripts that turbo never sees:

- `pnpm lint` is one oxlint pass over the **whole** repo. No app under `apps/` has a
  `lint` script, so `turbo run lint` covers `packages/` only — a lint error in a
  playground or in the docs app is invisible to turbo and fatal in CI.
- `pnpm format:check` is not a turbo task at all.
- `scripts/check-scaffold.mjs` packs the built packages, generates a project with them, installs,
  builds, and — for SSR — reinstalls with `--omit=dev` and serves two routes. **A template is data
  in this repository, not source**, so nothing else can tell you it works: the gate runs
  `ramonda-check` over `apps/docs` only, and `create-ramonda`'s own tests read template files as
  text. Four faults reached released packages through that gap. 5.6s per mode locally, because npm
  has the third-party half cached.
- `pnpm install --frozen-lockfile` is the FIRST thing CI does, and it was the one CI step the
  local gate did not have. Editing a `package.json` without reinstalling leaves the lockfile
  behind, everything local keeps passing — `pnpm check` never installs — and the push fails on
  `ERR_PNPM_OUTDATED_LOCKFILE` before a single test has run. It costs 1.3s when the two agree,
  and it goes first so it fails in seconds rather than after the build.
- `scripts/check-workflows.mjs` lints the **workflows themselves**: a job that runs
  a package script directly skips that task's `dependsOn`, which is how the docs
  deploy came to build nothing while every other check was green. It reads
  `turbo.json` for the tasks that have dependencies and refuses to see them
  invoked any other way. `SELFTEST=1` runs it against the offending line and
  against the corrected one, so it is known to catch the first and not the second
   — the first version anchored its patterns with `^`, matched nothing, and
  cheerfully reported the broken workflow as clean.
- `scripts/check-examples.mjs` type-checks every `ts`/`tsx` fence in the docs and the
  package READMEs against the real sources, so a renamed export breaks every example
  still using the old name. It runs **last**, after the build, because it derives the
  framework's names from `packages/*/dist/index.d.ts` — without them every example
  fails on `Component`. CI runs it as the second step of the `build` job for that
  reason, rather than in a job of its own.
- `node packages/check/dist/cli.js apps/docs/tsconfig.json` walks the docs app for a
  consumed context with no provider above it, and for class fields holding a function
  literal. This one is **local only** — in CI the same binary runs through the two
  `create-ramonda` templates' build scripts, which covers the published check but not
  this repository's own code.

A branch was once "green" on `turbo run check-types test build` while carrying a
sparse array in `apps/playground-ssr/server.mjs` and a misformatted file in
`apps/playground-core` — both committed, both would have failed `ci.yml`. Verify with
`pnpm check`, which runs everything CI runs, in the same order — plus the context
and arrow-field walk noted above, which CI does not run over this repository.

**The runtime is part of the gate too.** A newer local Node accepts APIs CI does
not have, so a green run here can still die on the first line there — which is how
`fs.globSync` (Node 22) reached CI from a machine on Node 24 while CI was pinned to
20. Two things came out of that: CI moved to **Node 24** (20 left support in April
2026, and nothing here has users to keep it for), and `pnpm check` starts with
`scripts/preflight-node.mjs`, which reads `.nvmrc` and warns when the local major
differs. A warning, not a failure — a newer Node is not a mistake.

To run the gate on a specific Node, put it first on `PATH`:

```
N=$(dirname "$(npx -y node@24 -p 'process.execPath')")
PATH="$N:$PATH" pnpm exec turbo run check-types test build --force
```

`--force` is not optional here — turbo will otherwise replay results cached under
your usual Node and report a pass having run nothing.

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

## Coverage

The `test` job **is** the coverage run: every package's test script carries
`--coverage`, so one execution is both the gate and the report, which is then merged
and published to [Coveralls](https://coveralls.io/github/NBlasko/ramonda) — free for
public repositories, on the built-in `GITHUB_TOKEN`. Coverage is still not a
*threshold* gate; nothing fails on a percentage (see *Deliberate gaps*).

It was briefly a separate `coverage` task in its own job, and that was wrong twice
over. It ran the whole suite a second time for one report — measured here, `turbo run
test --force` takes 116.6s and the instrumented run 126.9s, so the duplicate cost a
full extra ~2 minutes to save 10 seconds of instrumentation. And more seriously, the
second task name silently **dropped tests**: 21 test tasks against 18 coverage ones,
because `create-ramonda` (which tests the built bundle), `@ramonda/docs` and
`@ramonda/playground-ssr` (whose test boots a server and smoke-tests it) have no
coverage to produce and so had no `coverage` script. Under a `turbo run coverage`
gate the SSR smoke test — the one that caught the open-in-editor regression — would
not have run at all. A second name is a name that can be forgotten; there is one now,
and `turbo.json` declares `coverage/**` and `coverage-prod/**` as the `test` task's
outputs so a cache hit still restores the reports for the merge step.

Three pieces, each solving something a plain `vitest --coverage` gets wrong here:

- **`vitest.coverage.mjs`** (repository root) is the single definition of what
  counts, spread into every package's vitest config. Its load-bearing line is
  `include: ["src/**"]`. Without it v8 reports only the files a test imported, so a
  module nobody touches is not 0% covered — it is *absent*, and the percentage
  rises. Measured on `@ramonda/lens`: adding one never-imported file with three
  branches moved statements from 80.41% to 78.77% **once `include` was set**, and
  left the number untouched without it. Excluded: the tests, test support under
  `src/test/`, `.d.ts` and type-only modules. Not excluded: `src/testing.ts`, which
  is core's published `@ramonda/core/testing` entry.
- **`scripts/merge-lcov.mjs`** combines the per-package reports. vitest writes paths
  relative to the package that ran, so six packages produce six `SF:src/index.ts`
  records for six different files; these are rewritten to `packages/<name>/…`, which
  is also what makes a Coveralls line link to the right file. It **unions** rather
  than concatenates, because core, query and lens each have a second run under
  `NODE_ENV=production` — `__DEV__` is baked in per process, so the loop stops and
  stripped diagnostics are reachable only there, and each run reports the other's
  code as dead. Measured on lens: the development run hits 169 of 197 lines and the
  production run 89, but 4 of production's are lines development never reaches —
  **85.79% alone against 87.82% merged**. `SELFTEST=1` checks the union on two
  hand-worked reports, since a merge that takes the last report seen would look
  right on real input and be wrong here.
- **`turbo.json`** declares `coverage/**` and `coverage-prod/**` as outputs of `test`.

Whole-repository result today: **95.72% of lines, 4294 of 4486, across 109 files**
(core 73, query 13, testing-library 7, router 6, lens 6, devtools 4).

`create-ramonda` is deliberately absent. Its tests import the **built** `dist/index.js`
on purpose — they check that what gets published scaffolds a working project — so
measuring `src/` there would report 0% for code that is thoroughly tested, just not
in the form the report can see. Counting the bundle instead would mix a different
kind of number into the total.

The Coveralls upload is `continue-on-error`. A fork's pull request gets a read-only
token, so the upload would 403 and fail a check the contributor cannot fix; the
numbers are still computed and printed by the steps above it.

The badge is repository-wide, so it lives in the root README only. Package READMEs
carry version, minzipped size and licence — a repository-wide percentage next to one
package's name would read as that package's number.

## Security scanning

Four tools, split by what they can actually see. All four are free on a **public**
repository, which is what makes this configuration possible without an account, a
token or a monthly quota anywhere.

| Layer | Tool | Where it lives | Where findings appear |
|---|---|---|---|
| The code here (SAST) | CodeQL | `codeql.yml`, `.github/codeql/codeql-config.yml` | Security → Code scanning, and inline on the PR |
| Dependencies a PR adds | Dependency review | `dependency-review.yml` | The PR: a failing check, plus a comment |
| Dependencies already installed | Dependabot | `.github/dependabot.yml` (updates) + a repository **setting** (alerts) | Security → Dependabot, and update PRs |
| The repository itself | OpenSSF Scorecard | `scorecard.yml` | Security → Code scanning, plus a public grade |

**Alerts are a setting, not a file.** `dependabot.yml` only opens update pull
requests. The half that says "a version you have installed has a known
vulnerability" is a checkbox — see *One-time setup* below. This trips people
because the file is the visible part and the checkbox is the part that shouts.

**What the first Dependabot run changed.** Grouping worked — three pull requests
where nine would have been, one per group. Two things needed fixing, and both are
worth knowing before adding another bot:

- **The docs deploy failed on all three.** A Dependabot pull request never receives
  repository secrets, by design: its branch content is not the repository owner's.
  So `CLOUDFLARE_API_TOKEN` arrived empty, wrangler had nothing to authenticate
  with, and every bot pull request carried a red check that no reviewer could act
  on — while the build step above it passed. `deploy-docs.yml` dropped pull
  requests then, and has since dropped pushes too: it is started by hand, from
  `main`. Preview deployments are gone, and nothing about
  the docs goes unverified: `checks.yml` builds `@ramonda/docs` on every pull
  request through its whole chain. A preview supplied a URL, not confidence.
- **Dependabot rewrote a moving tag as a pin.** `github/codeql-action@v4` came back
  as `@v4.37.3`, which would mean a pull request for every CodeQL patch release
  from then on. `@v4` already excludes the only change that can break a workflow —
  a new major — so `dependabot.yml` now ignores patch and minor for that action.
  The exact pins elsewhere (`ossf/scorecard-action@v2.4.4`,
  `actions/dependency-review-action@v5.0.0`) stay, because those two publish no
  moving major tag to use instead.

**Both Dependabot rules are off, on purpose.** GitHub ships two auto-dismiss
presets (Settings → Advanced Security → Dependabot rules), and both are disabled
here.

*Dismiss low-impact alerts for development-scoped dependencies* reads as sensible
and is wrong for this repository: three runtime dependencies exist across every
published package (`@testing-library/dom`, `@clack/prompts`, `picocolors`) and the
other ~560 installed packages are toolchain. A rule that discounts dev-scoped
findings therefore filters almost the entire dependency surface rather than its
edge. The preset's reasoning — a vulnerability in a build tool goes nowhere,
because a developer's machine is not production — also inverts for a library
author: tsup and esbuild write the `dist/` that gets published, so a compromised
build tool is the one case that reaches everyone who installs Ramonda.

The cost of switching it off is noise of the "ReDoS in a test runner" kind, which
is acceptable and reversible: dismissed alerts are never deleted, they sit under
*Closed* marked auto-dismissed. And `pnpm audit` reads the advisory database
directly with no knowledge of these rules, so the unfiltered view is always one
command away.

*Dismiss package malware alerts* stays off for the plainer reason that a
false-positive filter on malware suppresses the one category worth interrupting
for.

**Why not Snyk.** It was the first candidate, and the badge is why it was dropped:
`snyk.io/test/github/<owner>/<repo>/badge.svg` returns the same 849-byte image
reading **"Snyk security | monitored"** for this repository, for another of the
author's, and for a repository name invented on the spot. It once printed a
vulnerability count; it is now a static picture. The scanning behind it is real
but needs an account, a `SNYK_TOKEN` and a monthly test cap, for a job CodeQL and
Dependabot already do here at no cost. What Snyk is remembered for — shouting
about transitive advisories in a Next.js app — is the Dependabot half of this
table, reading the same GitHub Advisory Database.

**One override, and its receipt.** `pnpm.overrides` in the root `package.json`
forces `esbuild` to `>=0.28.1`. Before it, `pnpm audit` reported one low advisory
([GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) —
arbitrary file read via esbuild's dev server, on Windows) reachable through 15
paths, all of them under `tsup` and `vite-plugin-dts`. Nothing here runs that dev
server, so the real risk was nil; the override costs one line and `pnpm audit` now
reports **no known vulnerabilities**.

It is an override rather than a bump because `tsup@8.5.1` is the latest release and
declares `esbuild: ^0.27.0` — there is no version of tsup to move to. The forced
version was already in the tree (Vite 7.3.6 accepts `^0.27.0 || ^0.28.0` and had
resolved 0.28.1), and the full gate was re-run uncached against it. Remove the
override once tsup declares `^0.28`.

## Required secrets

Set these under **Settings → Secrets and variables → Actions**.

| Secret | Used by | Notes |
|---|---|---|
| `NPM_TOKEN` | `release.yml` | npm **Automation** access token with publish rights for the `@ramonda` scope. |
| `CLOUDFLARE_API_TOKEN` | `deploy-docs.yml` | Custom token with **Account → Cloudflare Pages → Edit**. |
| `CLOUDFLARE_ACCOUNT_ID` | `deploy-docs.yml` | Your Cloudflare account id (in the dashboard URL). |

`GITHUB_TOKEN` is provided automatically; no setup needed. The three security
workflows add nothing to this table — CodeQL, dependency review and Scorecard run
on that token alone, which is the practical difference between them and a
third-party scanner.

## One-time setup

- **Three security switches**, under **Settings → Code security**. No workflow can
  turn these on — GitHub does not expose them to `GITHUB_TOKEN` — so they are
  clicked once, by the repository owner:
  1. **Dependabot alerts.** The half of Dependabot that watches the installed tree
     against the GitHub Advisory Database. `dependabot.yml` does not imply it.
  2. **Dependabot security updates.** Turns an alert into a pull request that
     raises the affected version, ignoring the weekly schedule.
  3. **Private vulnerability reporting.** Makes the *Report a vulnerability* button
     appear on the Security tab, which is where `SECURITY.md` sends people. Without
     it, that link 404s and the next reporter opens a public issue instead.

  A fourth row on the same page, **Dependabot version updates**, is the switch that
  consumes `.github/dependabot.yml`. It turns itself on when that file reaches the
  default branch — so leave it alone until then. Clicking *Enable* while the file
  is still on a branch offers to write GitHub's own template `dependabot.yml`
  straight to `main`, which collides with the one in review. (The *Advanced* button
  under CodeQL analysis does exactly the same thing with `codeql.yml`.)

  The buttons on that page name the **action**, not the state: a row reading
  *Disable* is a feature that is currently on.

  While you are on that page, check **Code scanning → CodeQL analysis**: it must
  read *Advanced* (this repository's `codeql.yml`), not *Default setup*. GitHub
  enables default setup by itself on some repositories, and when it is on it
  **rejects** the results our workflow uploads — the run fails with "default setup
  is enabled" rather than quietly duplicating work. If you see it, switch it off;
  `codeql.yml` replaces it and says why in its own header.

  Nothing else needs clicking: the dependency graph that dependency review reads is
  on by default for public repositories.
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
- **npm provenance.** Nothing to do — it works, and that is checked rather than
  assumed. `release.yml` publishes with the `NPM_CONFIG_PROVENANCE` env var, which
  needs `id-token: write` (already set) **and a public repository**, and the
  registry confirms the result: `@ramonda/core@0.3.0` carries an attestation with
  `predicateType: https://slsa.dev/provenance/v1`. Consumers verify it with
  `npm audit signatures`. If this repository ever goes private, drop the
  `NPM_CONFIG_PROVENANCE` line — the publish fails without a public source.
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
   `@ramonda/theme`) are ignored.
4. **Then deploy the docs by hand** — the Actions tab, *Deploy docs*, *Run
   workflow* on `main`. Nothing does it for you, on purpose; see below.

### What CI does not gate

`ci.yml` runs on every pull request to `main` and every push to it, so the tree
that gets merged is always checked. Making those checks **required** in branch
protection is the right setting, with one thing to know first.

The **Version Packages pull request is opened by the action itself**, using
`GITHUB_TOKEN`. GitHub does not start workflow runs for events caused by that
token — deliberately, so a workflow cannot trigger itself forever. A pull request
opened that way therefore gets **no `ci.yml` run at all**: no checks, and if the
checks are required, no way to merge it either. Its branch (`changeset-release/main`)
is pushed by the same token, so the `push` trigger does not save it.

Look at the next Version PR before turning branch protection on. If its checks
list is empty, pick one:

- **Give the action a token that is not `GITHUB_TOKEN`** — a fine-grained PAT or a
  GitHub App installation token, as `GITHUB_TOKEN:` in the `changesets/action`
  step. The pull request is then authored by that identity, workflows run on it
  normally, and it is gated like any other. This is the option that keeps one rule
  for everything.
- **Or exempt it**, and accept that the one tree nobody checks is the one being
  published. What that pull request contains is generated — version numbers and
  changelog text — so the risk is small, but it is not zero: `pnpm release` builds
  from it.

Whichever you choose, the check names to require are the ones the PR shows next to
each job (`Lint and format`, `Type-check`, `Test`, `Build`, prefixed by the calling
job). Copy them from a real run rather than guessing — a required check whose name
does not match anything blocks every merge, silently.

`deploy-docs.yml` runs no checks and does not need to: it builds the site, and a
build that fails fails the deploy. `checks.yml` also builds `@ramonda/docs` on every
pull request, so a break shows up before the merge.

### While the packages are pre-1.0, a breaking change is a `minor`

Changesets applies semver literally: `major` on `0.14.1` produces **`1.0.0`**, not
`0.15.0`. There is no "0.x is special" rule in it. So until these packages are
deliberately declared stable, a breaking change goes in as **`minor`** and is
described as breaking in its own text — which is what 0.x means anyway.

Picking `major` by reflex does more than bump one number. Every dependent declares
`"@ramonda/core": ">=0.1.0 <1.0.0"`, so core at `1.0.0` falls out of all of them
and changesets majors **`@ramonda/form`, `@ramonda/router` and
`@ramonda/testing-library` as well — packages with no change in them at all**.
Four unintended 1.0.0s from one word in one file.

`pnpm changeset status --verbose` prints the exact versions a merge would produce.
Run it before merging a batch; it is the only place that cascade is visible.

### Letting releases accumulate

Nothing publishes until you merge the Version Packages PR, so leaving it open is a
normal way to work rather than a state to get out of. Merge as many feature PRs as
you like: each push to `main` re-runs the action, which recomputes that PR from
**all** pending changesets and force-pushes its branch (`changeset-release/main`).
Versions and changelogs are rebuilt from scratch every time, so they are right for
the whole batch and not for whichever merge happened to be first.

Two consequences of "rebuilt from scratch": editing the Version PR by hand is
pointless — the next merge to `main` overwrites it — and the bumps aggregate by
the highest one, so three patches and one minor make a minor.

The docs deploy is manual because it is the one step whose right moment is not a
push. It should describe the packages that are **on npm**, which is true only
after step 3, and step 3 can be days after the feature merges that will appear in
it. So the sequence is: merge features → merge the Version PR (publishes) → run
*Deploy docs*.

**The very first publish** needed no changeset: the packages were not on npm yet,
so merging to `main` published them at the versions they already carried. Every
bump since comes from a changeset.

`CHANGELOG`s link back to PRs and authors via `@changesets/changelog-github`,
which reads `GITHUB_TOKEN` — already provided in CI. (Running `pnpm changeset
version` locally would need a `GITHUB_TOKEN` in your env; normally you let the
Version PR do it.)

## What passes today (measured)

Run locally, uncached (`--force`), in the runner's conditions — `ps` shadowed and
`$EDITOR`/`$VISUAL` empty, so nothing can pass by finding a tool a runner does not
have:

- **`pnpm check`** — 39 of 39 turbo tasks, 0 of them cached, plus the root scripts
  turbo never sees.
- **Test** — 16 test tasks, no filters and nothing excluded: **1504 tests in 184
  files**. That includes `@ramonda/playground-ssr`, whose test builds the app, boots a
  real Node server and smoke-tests it, and `@ramonda/docs`. Coverage comes out of this
  same run — `node scripts/merge-lcov.mjs` — at **95.16% of lines**, 5293 of 5562,
  across 135 files.
- **Build** — green across every package and app, including the docs
  content → esbuild → prerender → pagefind chain and `ramonda-check-bundle` parsing
  every emitted file.
- **Documentation examples** — 235 `ts`/`tsx` blocks across 80 files type-check
  against the real sources; 24 are not standalone code and 4 are marked as not one
  program.
- **Type-check** — green. core runs `strict` plus `noUnusedLocals` /
  `noUnusedParameters` / `noImplicitOverride` / `noFallthroughCasesInSwitch`.
- **Lint** — **green and blocking** (oxlint), 0 errors across the monorepo.
- **Format** — **green and blocking** (biome), 529 tracked files, no fixes to apply.

Both build-time checks run their own self-test first, since a check nobody has seen
fail proves nothing: `scripts/check-workflows.mjs` (catches a workflow bypassing
turbo, passes the correct form) and `scripts/merge-lcov.mjs` (unions two hand-worked
reports rather than letting the last one win).

## Pinned dev dependencies (do not blindly bump)

Three dev/build-time deps are deliberately held back. **None of them affect the
published packages** (those ship via tsup/esbuild; consumers bring their own
TypeScript). Each latest major breaks the setup for no shipped benefit — revisit
only with the fix in hand:

- **`vite` held at `^7`.** Vite 8 switched to the oxc transformer, which ignores
  the `esbuild: { jsx: "automatic" }` block the vitest configs use, so JSX stops
  compiling in tests (`SyntaxError`). To move to 8, configure oxc's JSX pragma in
  every vitest config. (See the note in `packages/router/vitest.config.ts`.)
- **`jsdom` pinned to `28.0.0`.** 28.1+/29 changed CSSOM `cssText` serialization
  (a color keyword comes back as `rgb(...)`), which breaks the RMD007 style-
  normalization test and a test that spies on `cssText`.
- **`typescript` held at `^5.9`.** TS 7 (the native rewrite) removed `baseUrl`,
  which every tsconfig uses with `paths`, and tsup's `.d.ts` generation is not
  known to support it yet.

## Deliberate gaps (the "we'll add more later" list)

- **A coverage threshold.** Coverage is measured, merged and published (see
  *Coverage* above), but nothing fails on a percentage. A gate picked today would be
  a number nobody chose, defending a suite still being written. Add one when the
  suite settles, at a level the suite already clears.
- **CodeQL's `security-extended` suite.** The default (high-precision) suite runs
  now. Escalating is one uncommented block in `.github/codeql/codeql-config.yml`,
  and the time to do it is after the default suite's findings are triaged — the
  `innerHTML` writes in `packages/devtools/src/index.ts` first.
- **SHA-pinned actions.** Workflows pin tags (`@v7`, `@v2.4.4`), not commit SHAs.
  Scorecard marks this down, and it is right that a tag can be moved under you;
  a SHA is also unreadable and drifts silently out of date. Revisit if Dependabot's
  `github-actions` updates prove reliable enough to keep SHAs current.
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
- **Node version matrix.** CI runs one version, from `.nvmrc`. A matrix is worth
  adding when the packages have users on other majors — which is a `1.x` concern,
  not a `0.x` one. Until then a second version costs CI minutes to prove something
  nobody depends on.
