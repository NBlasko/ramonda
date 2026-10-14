---
title: create-ramonda
description: The scaffolder — every question it asks, the flag that answers each one, what every project gets, and the scripts it writes.
section: Reference
order: 116
---

# create-ramonda

`create-ramonda` starts a project: it asks a few questions, writes a project that builds, and
installs it. It needs **Node 24** or newer, and stops with a message on anything older.

```install
create ramonda@latest my-app
```

`my-app` is the folder it writes into. Leave it out and it asks, offering `ramonda-app`.

## What it asks, and the flag for each

Every question has a flag. A question a flag answers is not asked.

| Question | Flag | Default |
|---|---|---|
| Where should the app go? | the folder, as the first argument | `ramonda-app` |
| How should it render? | `--mode spa` or `--mode ssr` | `spa` |
| Add packages and tooling? | `--add <list>`, comma-separated, or `--add none` | `css,devtools` |
| Initialise a git repository? | `--git` or `--no-git` | yes |
| Install dependencies? | `--install` or `--no-install` | yes, with the package manager that ran it |
| The folder is not empty — write into it? | `--overwrite` | no |

`--yes` (or `-y`) takes the default for every question no flag answers. It never writes into a folder
that is not empty: that takes `--overwrite`, always. `--help` prints all of this; `--version` prints
the version.

With npm, the flags go after `--`, which tells npm they are for the scaffolder:

```sh
npm create ramonda@latest my-app -- --yes
npm create ramonda@latest my-app -- --mode ssr --add css,query,testing --no-git
```

### With no terminal

A script, a CI job or an agent has no terminal to answer a question in. There, every question must
be answered by a flag or by `--yes`. If one is not, the scaffolder writes nothing, names the flags
that are missing, and exits with code 1.

## How it renders

**`spa`** — the app runs in the browser. Vite serves it in development and builds it for production.

**`ssr`** — a small Node server renders each page to HTML, and the browser takes it over. Each route
says how it renders: baked to a file at build time, cached and refreshed, or rendered per request.
Server rendering is built on the router, so an `ssr` project always has it.
[Server rendering](/ssr)

## The add-ons

The word in the first column is what `--add` takes.

| `--add` | Adds | For |
|---|---|---|
| `css` | `@ramonda/css` | [Style blocks](/style-blocks): the page written in blocks, a few tokens, and a strict `ramonda.css.ts` |
| `router` | `@ramonda/router` | [Routing](/routing): routes and links. Always there with `ssr` |
| `query` | `@ramonda/query` | [Async data](/query), cached and race-free |
| `form` | `@ramonda/form` | [Forms](/forms) with typed fields and schema validation |
| `lens` | `@ramonda/lens` | [Immutable updates](/lens) to nested state |
| `testing` | vitest, `@ramonda/testing-library` and jsdom | [Testing](/testing), with one test to start from |
| `devtools` | `@ramonda/devtools` | [The panel](/devtools), in development only. A tab for each of `query` and `form` you also chose |
| `biome` | `@biomejs/biome` | Lint and format |

Whatever you choose, every project also gets `@ramonda/core`, [`@ramonda/build`](/reference/build)
and [`@ramonda/check`](/reference/check). An `ssr` project also gets `@ramonda/server` and
`@ramonda/router`.

A package you did not add at the start installs like any other later. [The packages](/reference/api#the-packages)
lists them all.

## The scripts

| Script | What it runs | There when |
|---|---|---|
| `dev` | The development server, with hot reload | always |
| `build` | `ramonda-check`, then `typecheck`, then the production build, then `ramonda-check-bundle` over what it emitted | always |
| `build:bundles` | The production build alone, which `build` runs in the middle | `ssr` |
| `typecheck` | `tsc --noEmit` — or, with `css`, `ramonda-css`, which is the same check reading style blocks too | always |
| `check` | `lint` and `test`, where the project has them, then `build` — the one to run before a commit | always |
| `test` | The tests, once | `testing` |
| `test:watch` | The tests, again on every change | `testing` |
| `lint`, `format` | biome — and with `css`, `ramonda-css lint src` and `ramonda-css format src` for the files biome cannot read | `biome` |
| `preview` | The production build, served locally | `spa` |
| `start` | The production server | `ssr` |

[`ramonda-check`](/reference/check) proves what a running page cannot, such as a context consumer
with no provider above it, from the source. [`ramonda-check-bundle`](/reference/check#the-bundle-that-did-not-parse)
reads what the build emitted, and fails on code a browser could not parse — decorators a bundler
left untransformed. `ramonda-css` is described in
[Tooling](/style-blocks/tooling).

## The files

Both modes:

| File | What it is |
|---|---|
| `src/App.tsx` | The app. With `css`, its page is written in style blocks |
| `vite.config.ts` | Vite, with `ramonda()` from `@ramonda/build` |
| `tsconfig.json`, `index.html`, `README.md`, `.gitignore` | What they are anywhere |
| `pnpm-workspace.yaml` | For pnpm only: it lets esbuild run its install script. npm and yarn ignore it, and it does not make the project a workspace |

`spa` adds `src/main.tsx`, which mounts the app, `src/style.css`, and `src/vite-env.d.ts` for
Vite's types. `ssr` adds:

| File | What it is |
|---|---|
| `src/entry-client.tsx` | Takes over the server-rendered page in the browser |
| `src/entry-server.tsx` | Says how each route renders |
| `server.mjs` | The server, for `dev` and for `start` |
| `scripts/build.mjs`, `scripts/prerender.mjs` | The production build, and the pages baked at build time |
| `global.d.ts` | Types for `import.meta.env` |

And per add-on: `ramonda.css.ts` and `css-system/` with `css`; `vitest.config.ts` and
`src/App.test.tsx` with `testing`; `biome.json` with `biome`. With `devtools`, the entry imports the
panel inside `if (import.meta.env.DEV)`, so a production build leaves it out.

## Next

- [Installation](/guide/installation) — the same start, and adding Ramonda to a project you have.
- [Your first component](/guide/first-component) — what to write in `src/App.tsx`.
- [The packages](/reference/api#the-packages) — everything that can be added later.
