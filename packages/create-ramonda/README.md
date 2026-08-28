# create-ramonda

Scaffold a [Ramonda](https://ramonda.dev) app: pick your rendering mode and your packages, then run
it. The bundler is already configured.

[readme:start]: #

[![npm](https://img.shields.io/npm/v/create-ramonda)](https://www.npmjs.com/package/create-ramonda)
[![license](https://img.shields.io/npm/l/create-ramonda)](https://github.com/NBlasko/ramonda/blob/main/LICENSE)

> **Status: `0.x`.** The API changes freely between releases while the design is
> being explored; from `1.0` the interfaces hold. See the
> [root README](https://github.com/NBlasko/ramonda#readme).

```sh
npm create ramonda@latest my-app
```

Documentation: **[ramonda.dev/guide/installation](https://ramonda.dev/guide/installation)**

[readme:end]: #

`pnpm create ramonda` and `yarn create ramonda` work too.

```bash
cd my-app
npm install   # unless you let it install for you
npm run dev
```

Open the address it prints and you have a working app.

## What it asks

**A client-side app, or a server-rendered one.** The SPA template mounts into an empty page. The SSR
template ships a small Node server that renders to HTML and hydrates — and always includes the
router, because server rendering is built on it.

**Which packages and tooling to add**, as a multi-select:

| | |
| --- | --- |
| [`@ramonda/router`](https://ramonda.dev/routing) | routes and links |
| [`@ramonda/query`](https://ramonda.dev/query) | cached, race-free async data |
| [`@ramonda/form`](https://ramonda.dev/forms) | typed fields and schema validation |
| [`@ramonda/lens`](https://ramonda.dev/lens) | immutable updates to nested state |
| [`@ramonda/testing-library`](https://ramonda.dev/testing) | render and query components in tests |
| [`@ramonda/devtools`](https://ramonda.dev/devtools) | the panel, which grows with the choices above |
| Biome | lint and format in one tool |

## What you get

A project that runs, with nothing left to configure. Ramonda needs three settings from a bundler —
decorators, the JSX runtime, and the import source — and [`@ramonda/build`](https://ramonda.dev/reference/build)
carries all three, so the generated config names none of them.

Every dependency is written at the version this scaffolder was released alongside — each package's
own, derived at build time from the workspace rather than typed into a template. The ranges were
hand-maintained once, and a fresh project's first `install` failed with *No matching version found*
the moment a package moved on without them.

## Already have a project?

You do not need this. See [adding Ramonda to an existing
project](https://ramonda.dev/guide/installation#adding-ramonda-to-an-existing-project) — it is two
installs and one bundler plugin.

## License

[MIT](../../LICENSE) © Nikola Blagojević
