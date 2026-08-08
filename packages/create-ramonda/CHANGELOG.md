# create-ramonda

## 0.8.1

### Patch Changes

- 01daedf: A scaffolded SPA type-checks before it is touched

  A fresh project reported two errors in the file the scaffolder wrote itself:

  ```
  src/main.tsx  Cannot find module './style.css'
  src/main.tsx  Property 'env' does not exist on type 'ImportMeta'
  ```

  The code was right — Vite injects both — and only the types were missing. The second is the sharper
  one, because the scaffolder GENERATES that line: the devtools panel is imported behind
  `if (import.meta.env.DEV)`, so every SPA shipped with a type error in it.

  The template now carries `src/vite-env.d.ts` with `/// <reference types="vite/client" />`, which is
  one line and is where `npm create vite` puts it too. It declares `ImportMeta.env` and the `*.css`
  modules, so a CSS-module import types its class names as well. Verified against a real scaffold:
  `tsc --noEmit` fails without the file and passes with it.

  SSR is unaffected and deliberately different — esbuild, `__DEV__` from its own `global.d.ts`, no CSS.

## 0.8.0

### Minor Changes

- 68f9163: JSX goes through an automatic runtime, and the factory is renamed `__h`

  Setting Ramonda up used to mean naming a factory (`jsxFactory: "__ramondaH"`), injecting it into
  every module, and declaring it in a `global.d.ts` — and then holding two names in your head, because
  the package exported `h` while compiled JSX called `__ramondaH`.

  Now the compiler imports what it needs, per file:

  ```jsonc
  { "jsx": "react-jsx", "jsxImportSource": "@ramonda/core" }
  ```

  ```js
  esbuild: { jsx: "automatic", jsxImportSource: "@ramonda/core" }
  ```

  No factory name, no `jsxInject`, no `jsx-shim.ts`, no global declaration. `npm create ramonda`
  writes it this way, and both templates lost a file each.

  **Breaking.** `h` is no longer exported; the factory is `__h`, for the vnodes a tag cannot express —
  a runtime tag name, spread children. Compiled JSX never calls it. To migrate, change the two config
  keys above, delete the inject and the global declaration, and rename any hand-written `h(` to `__h(`.

  Two new subpaths ship with core: `@ramonda/core/jsx-runtime` and `@ramonda/core/jsx-dev-runtime`.
  Both are needed — every bundler's development mode imports the second one.

  Fragments still do not exist. `<>…</>` throws with the reason rather than half-working, because one
  tag producing several elements is what the one-tag-one-element rule is about.

### Patch Changes

- e623571: `@ramonda/check` finds class fields holding a function literal, and its bin is now `ramonda-check`

  Ramonda binds every method to its instance, so `onPick = (id) => this.select(id)` buys nothing over
  `onPick(id) { … }` and costs one closure per instance. The check reports each one, and says which of
  the two fixes applies: a body that reads `this` wants to be a method, a body that does not wants to
  leave the class.

  It reads the source because nothing else can. At runtime the two are indistinguishable — by the time
  anything could look, the framework has written a bound function onto the instance under every
  method's name, and a field holding `debounce(this.save, 200)` is a function there too. That one is
  legitimate: a wrapper cannot be written as a method. Only the source tells a function literal from a
  call that returns one. `static` fields are not reported either — one per class, so nothing to save.

  **The bin is renamed** from `ramonda-check-context` to `ramonda-check`, because it no longer checks
  only contexts. Update the `build` script: `ramonda-check && …`. `npm create ramonda` writes the new
  name.

  `@ramonda/query` had one of these itself — `Query.observe` was an arrow field and is now a method.

- e06dd85: A devtools tab is its own entry, and a package only announces

  ```ts
  if (import.meta.env.DEV) {
    void import("@ramonda/devtools");
    void import("@ramonda/query/devtools");
    void import("@ramonda/form/devtools");
  }
  ```

  Each tab now lives behind `/devtools` on its package, and importing that entry registers it.
  `create-ramonda` writes these lines for the add-ons you pick.

  **Why it moved.** A package that imports the module describing its tab puts that description into
  the bundle of every application using the package — `__DEV__` strips it from production, but not
  from development. Measured: 12.4 KB of query and 5.2 KB of form were in the development bundle of
  every app, whether or not anyone ever opened the panel. Both are now only in the bundle of an app
  that asked for a tab.

  **How a package reaches its tab instead.** An event. `QueryClientProvider` and `Form` announce
  themselves arriving and leaving with one `__DEV__`-guarded line each, and the entry listens and
  keeps whatever list it needs. Nothing about a panel lives on the class — no field, no method, both
  of which ship whatever the guard says — and the package does not know whether anybody is listening.

  That is the shape core already uses for `ramonda:tick` and `ramonda:dev-log`.

  Nothing changes for an app beyond the import lines: both tabs look and behave as before.

## 0.7.1

### Patch Changes

- 4384f18: Devtools takes plugins, and Query and Forms are the first two

  **A package can register a tab.** `@ramonda/devtools` exports `panelRegistry()`, and anything that
  registers a description gets a tab built for it. The description is DATA, never markup: a row has a
  title, a status, typed fields, an optional value and its actions, and the panel decides what all of
  that looks like. That keeps the tool the app is diagnosed with out of the app's hands, keeps its
  look coherent, and keeps the contract small enough to version honestly. See
  [Adding a tab](https://ramonda.pages.dev/devtools/panels).

  ```ts
  const off = panelRegistry().register({
    version: 1,
    id: "sockets",
    label: "SOCKETS",
    snapshot: () => ({
      groups: [
        {
          rows: [
            {
              id: "ws-1",
              title: "wss://api.example.com",
              status: "ok",
              fields: [
                { kind: "live", id: "age", text: "last message 4s ago" },
              ],
              value: { data: lastFrame, revision: frameCount },
              actions: [{ id: "close", label: "close" }],
            },
          ],
        },
      ],
    }),
    run: (rowId, actionId) => undefined,
  });
  ```

  Register from an instance's lifecycle rather than at module import, so the list is exactly the live
  sources. A field marked `live` — a clock, a countdown — keeps its own text node while the rest of
  the list holds still, which is what stops a tab rewriting itself twice a second.

  **`@ramonda/form` has a Forms tab.** Every mounted form, whether it is valid, how many fields are
  blurred and edited, and a row per field that is actually wrong — with whether that field has been
  interacted with at all, which is the answer to "it says this is required and I have not touched it".
  `reset` and `submit` go through the form, so submit is the real one, validation and `onSubmit`
  included. The values are read-only: a form holds the schema's input side, and a `Date` does not
  survive being typed back as JSON.

  **`@ramonda/query` describes its own tab now.** The panel used to know what a query row looks like:
  which badge means fetching, that `observers: 0` is worth calling out, that a bounded copy must not
  be editable. That is knowledge about a cache, and it lives with the cache. `__RAMONDA_QUERY__` is
  gone — the registry replaced it — and with it the `QueryBridge` / `QueryRow` / `QuerySnapshot`
  types, which existed only to carry a cache to something that knew how to draw it.

  Nothing changes for an app: the Query tab looks and behaves as it did.

  **A removed panel kept calling into the app.** `disconnectedCallback` stopped neither poll timer, so
  a panel taken out of the document went on asking the cache for a snapshot and the profiler for its
  commits — measured at thirteen further calls over five seconds, and still going. Every tab is
  stopped on teardown now.

  `panelRegistry` and the contract's types are the package's first public exports — everything else
  in it is the panel's own implementation, imported for its side effect.

  **Internal: the panel splits into modules.** `index.ts` goes 2777 → 765 lines; what is left is the
  frame — docking, dragging, tabs, logs. The component tree, the value viewer, the profiler and the
  plugin renderer are their own files.

## 0.7.0

### Minor Changes

- 5ae3938: The SSR template renders on linkedom instead of jsdom

  A scaffolded SSR project gets `linkedom` where it used to get `jsdom`, and `server.mjs` builds its
  document with it.

  Two reasons, both measured against this repo's SSR playground running its whole smoke suite on each:

  - **It needs no Node built-in**, where jsdom needs ten. That is what lets the same server run on
    Cloudflare Workers, Deno Deploy or Vercel Edge, which jsdom cannot.
  - **It is faster per request**, and the gap is mostly construction — which `installDom` pays on every
    request. On the live server, a real dynamic route: 9.49 ms → 2.97 ms. In isolation, a 30-row
    render: 8.53 ms → 0.66 ms, of which 4.8 ms was jsdom building a document before any rendering
    started.

  The output was compared rather than assumed: across 111 nodes of a prerendered page, ignoring
  attribute order, exactly one thing differs — jsdom writes `style="display: contents;"` and linkedom
  `style="display: contents"`, because jsdom normalises through its CSS parser. Same CSS, one byte.

  Three globals linkedom does not supply are provided by the template: `location` is real, since the
  router reads it during a server render, and is built from the request URL; `history` accepts and
  discards, because a server has no session history; `MouseEvent` and `getComputedStyle` are stubs so a
  module that merely references one at import does not throw.

  **`jsdom` is still installed by the `testing` add-on**, in both modes now rather than SPA only. There
  it stands in for a BROWSER — vitest's `environment: "jsdom"` — which is a different job from being
  the DOM a server renders into, and one linkedom is not trying to do. An SSR project with tests
  previously got jsdom for free from the server; it no longer does, so it is requested explicitly.

## 0.6.0

### Minor Changes

- 2d6ef19: `@ramonda/form` — the first release

  Forms as a hook: `this.use(Form<typeof schema>, { schema, defaultValues, onSubmit })`. It adds no
  element, so the `<form>` tag stays yours — with your class names, your `noValidate`, and the freedom
  to put a form inside a `<fieldset>` or a `<tr>` where a wrapper would be invalid HTML.

  - **Validation is Standard Schema v1**, so bguard, zod, valibot and arktype all work as they are,
    with no adapter and no dependency from this package on any of them. `defaultValues` and the values
    handed to `onSubmit` are both typed from the schema, and the input and output sides are kept apart
    — a schema that coerces a string to a number is honoured on both.
  - **Fields are property access, not string paths** — `f.address.street`. A typo is a compile error,
    and renaming a schema field breaks the render instead of quietly reading `undefined`.
  - **The whole field API sits behind one token**: `f.address.street.$.error`. A flat API was tried
    first and `value` collided with an ordinary `contacts: { kind, value }[]`; one collision chance
    instead of eleven, and it measured cheaper on a deep schema.
  - **`bind` is everything a control needs** — `name`, `value`, `onInput`, `onBlur`, `aria-invalid`,
    and the right `type` for what the field holds. The handlers are built once per field, so spreading
    it every render re-attaches nothing.
  - **Array rows carry a generated id**, per array rather than per form, so a row keeps its element,
    its message and its caret across an insert or a remove — and a server render and its hydration
    agree on every `list()` key.
  - **Messages stay hidden until they are ready to be seen**: a field must be blurred, edited, or the
    form submitted. `isValid` always reports the real answer underneath.
  - **Server rendering needs nothing wired up.** `name` and `value` reach the HTML, so the page is a
    real form before any JavaScript runs.
  - **A failed submit puts the caret in the first invalid field**, first in the order on screen rather
    than the order the validator reported. Without it, pressing the button does nothing visible when
    the messages are below the fold — and for someone using a screen reader, no signal at all. Scoped
    to the form the submit came from, so a page with two forms cannot steal focus into the other; a
    disabled control is skipped; a programmatic `submit()` moves nothing, since your code called it and
    your code decides where the reader looks.
  - **`move(from, to)` on an array field** reorders a row and carries its identity with it. `remove`
    then `insert` mints a new id, so the reconciler drops the row's element and builds another, losing
    the caret and the selection — which is exactly what row ids exist to prevent, so the library does
    it rather than every app.

  ### `@ramonda/form/bguard`

  A second entry point for the two things Standard Schema cannot express, because they are not about
  validating a value. bguard is an **optional** peer dependency and the main entry never reaches this
  module, so a form over zod pulls in nothing from it. It imports no `@ramonda/core` either, so it runs
  in a bare Node process with no DOM.

  - **`htmlConstraints(schema)`** derives the HTML validation attributes — `required`, `minlength`,
    `maxlength`, `pattern`, `min`, `max`, and `type` from a format. The schema already says
    `minLength(3)`; writing `minlength={3}` beside it is the same fact twice, and the two drift.
    Answers are cached per path, because RMD020 compares attributes key by key and a fresh object would
    be reported for every input on the page. An exclusive bound is left out rather than reported one
    short, and `uuid` produces nothing, since no `<input type>` means it.
  - **`unknownRefPaths(schema, values)`** finds a cross-field rule that points at nothing.
    `ctx.ref('pasword')` returns `undefined` for ever and the comparison quietly succeeds or quietly
    fails; it is the shape of bug that survives a review because the line reads correctly. It belongs in
    a test. It needs values because a `custom` is opaque — a rule that does not run reads nothing, so it
    cannot be checked, which is stated rather than hidden. `ctx.sibling` is covered too, which is where
    it earns most: its string form is the one the compiler cannot check. One rule is one entry however
    many rows it ran on, with the index shown as `*` — reported per row, a single typo on a fifty-row
    list produced fifty entries.

  `revalidateAll` is **removed** from `FormProps`. It was declared and documented as the escape hatch
  for a form big enough that whole-form revalidation would hurt, and it was never read — an option that
  did nothing, which is worse than one that is missing. It is gone rather than implemented, because the
  case does not exist: measured on a bguard schema with a `custom` per field plus a cross-field rule,
  a whole-form pass costs 3.3 µs at 11 fields, 14.9 µs at 31, 48.3 µs at 101 and 154.8 µs at 301 — a
  three-hundred-field form revalidates in a hundredth of a 60fps frame.

  `pick`-based per-field validation was the original plan for the submodule and is deliberately absent
  for the same reason, plus three hazards it carried: `pick` brings the source's object-level assertions
  along, so a whole-form rule would run against a partial value and invent an issue; it reaches
  top-level keys only; and the dependency graph is discovered by running rules rather than known up
  front. Each shows a wrong or stale message, to save ten microseconds.

  Documentation: [Forms](https://ramonda.pages.dev/forms).

  `create-ramonda` offers it as an add-on, so `npm create ramonda@latest` can scaffold a project with
  it already installed.

## 0.5.0

### Minor Changes

- 854742e: New projects get `jsxFactory: "__ramondaH"` instead of `h`, because a one-letter factory is a name
  someone will reuse — and reusing it broke the file, sometimes silently.

  The factory is only in scope because the bundler injects it, and **a bundler injects an identifier
  only if it is not already bound**. So a binding named `h` wins. Measured with esbuild:

  ```tsx
  const h = 5; // in a function → TypeError: h is not a function
  function h(x) {
    return x;
  } // at module top → NO error at all
  export function Card() {
    return <div>ok</div>; // becomes YOUR h("div", …) — the page is silently wrong
  }
  ```

  The module-level case is the bad one: no error, no warning, wrong output.

  `__ramondaH` is a name nobody writes, so the collision cannot happen. **It costs nothing** — the
  bundle is byte-identical (12223 B gzipped either way on a hello-world), because a named import
  tree-shakes exactly as before and the minifier shortens the binding again. A namespace factory
  (`R.h`) also fixes it and was rejected: it defeats tree-shaking, +36% gzipped.

  **Nothing to migrate.** `h` is still exported and still declared as an ambient global, so a project
  configured with `jsxFactory: "h"` keeps type-checking and building exactly as it did. Only new
  scaffolds and the docs' setup instructions changed.

## 0.4.0

### Minor Changes

- ef51691: New package **`@ramonda/check`** — proves every context consumer has a provider above it, before
  the app is ever opened.

  The runtime diagnostic (RMD003) can only speak when a branch actually renders, so a consumer
  behind a condition nobody exercised — or in a chunk nobody loaded — ships with the fault
  undetected. The commonest way to get there is a reorder: the provider moves, the consumer stays,
  and the page still renders because the context quietly falls back to its default.

  ```
  $ ramonda-check-context

    src/App.tsx:57:11
      <UserPage> consumes "Theme" — nothing provides it on this path:
      App → Sidebar → UserPage
  ```

  **It only reports what it can prove.** Anything it cannot resolve — a component chosen from a
  variable, a registry, a prop — makes it go quiet for that path rather than guess, which is what
  makes it safe to fail a build on: a report is a real broken path, never a maybe. It follows JSX
  (children of a component belong to that component), `list({ as })`, route tables through
  `<RouteOutlet routes={…}>`, and contexts a hook carries for its owner.

  Scaffolded projects run it as the first step of `build`, so a lost provider fails the build
  instead of reaching a browser. Existing projects: add `@ramonda/check` as a dev dependency and put
  `ramonda-check-context && ` in front of your build script. `typescript` is a peer dependency — the
  analyzer uses your compiler, so it reads your own syntax and config.

### Patch Changes

- d1e56fc: Two regular expressions replaced with linear scans. Both were the same shape — `+` anchored at
  `$`, which cannot match when the string does not end in the run it is looking for, so the engine
  retries from every position and backtracks the whole run each time.

  **`normalizePathname` (router)** is the one that mattered: it reads
  `window.location.pathname`, so the string comes from whatever URL someone was handed. Measured on
  `"/".repeat(n) + "a"` — 30k slashes took 942ms, 60k took 3.7s. A link with enough slashes hung the
  tab that opened it. The scan handles 200k in about a millisecond.

  **`create-ramonda`** trimmed dashes off a derived package name the same way (`/^-+|-+$/g`); only a
  folder name reaches it, but it is published source, and two loops are the right way to trim
  anyway. Output is unchanged on all 17 shapes checked.

  **`ramonda-check-context`** derived the tsconfig's directory with a regex; it now uses
  `path.dirname`, which is what the operation is called. Reported by CodeQL. The analyzer's result is
  unchanged — same components, same contexts, same issues, verified against an absolute path, a
  relative one, and one already ending in a separator.

  Separately, two `console` calls built their message by interpolation and passed a value after it.
  A console treats its first argument as a **format string**, so a `%s` inside the interpolated part
  consumed the argument that followed — and in both cases that argument was the payload:

  ```
  of /about%s failed:  →  "of /aboutupstream down failed:"   (the error never printed)
  ```

  `createIsrCache`'s default `onError` lost the reason a rebake failed; the devtools log row lost the
  data you clicked it to see. Both now use a `%s` placeholder. Reported by CodeQL for the first one.

- 62d536e: ISR pages now live in a store you choose, instead of a `Map` in your server file.

  `@ramonda/router/server` gains `createIsrCache`, `memoryStore` and `fileStore`. The cache owns the
  timing — fresh, stale-while-revalidate, cold — and the store owns where pages are kept:

  ```ts
  import { createIsrCache, fileStore, routePlan } from "@ramonda/router/server";

  const isr = createIsrCache({
    plan: routePlan(server),
    store: fileStore({ dir: "dist/isr" }),
    render: bakePath,
  });

  // `undefined` means "not an ISR route" — fall through to static or dynamic.
  const page = await isr.serve(path);
  if (page) sendHtml(res, page.html, page.mode);
  ```

  **Why it needed to change.** A per-process `Map` is correct for one instance and wrong for two:
  each caches independently, so a visitor bounces between a copy baked ten seconds ago and one baked
  ten minutes ago with no way to tell which they got, and a restart empties it so every ISR route
  renders cold again — repeatedly, during a rolling deploy. `fileStore` fixes both for instances that
  share a volume; anything else is two methods (`get` / `set`) over Redis, a database, or whatever
  your instances do share.

  Two things the old inline version did not do:

  - **Single-flight.** Ten requests arriving while a stale page rebakes now start one render, not
    ten — the stampede a slow page under load used to produce.
  - **A failed background rebake keeps serving the stale page** rather than surfacing as an error. A
    failed _cold_ render still throws, because there is nothing else to send.

  The scaffolded SSR app uses `fileStore` and clears the cache in its prerender step, since pages
  baked by the previous bundle must not be served against a new client bundle.

## 0.3.0

### Minor Changes

- 59e9a6a: SSR scaffolds now have a hot-reload dev server.

  `npm run dev` on an SSR project starts a Vite server in middleware mode instead of
  building the bundles and booting Node: edit a component and the change is live — the
  browser hot-updates the client, and the server picks up the new code on the next
  request via `ssrLoadModule`, with no restart and no build step. Production is
  unchanged: `npm run build` + `npm start` still serve the esbuild bundle.

  The one thing that made this work with Ramonda's TC39 decorators is `esbuild.target:
"es2022"` in `vite.config.ts` — Vite's default SSR target (`esnext`) leaves decorators
  in the output, which Node can't parse (`ssrLoadModule` died on `@Host(...)`). es2022
  down-levels them. `vite` is added as a dev dependency of the SSR template; `server.mjs`
  branches dev (Vite) vs `--prod` (built output).

- c814a8c: The SSR template is now a routed app with per-route rendering modes — SSG, ISR, and dynamic.

  Scaffolding an SSR project gives you a small routed app (`createRoutes` + `createRouter`, so
  `<Link href>` is type-checked against your routes) whose `entry-server.tsx` declares how each
  route renders:

  ```ts
  defineServer(routes, {
    "/": { prerender: true }, // static — baked at build
    "/about": { revalidate: 60 }, // ISR — cached, rebaked every 60s
    "/hello/:name": {}, // dynamic — rendered per request
  });
  ```

  `npm run build` bakes the static routes to `dist/static/` (failing loudly if a route marked
  `prerender` reads the request — a baked page must never contain per-request data), and
  `server.mjs` in production serves each request by its mode: static file, ISR (cached +
  stale-while-revalidate), or a per-request `renderToString({ request })`. Dev is unchanged
  (Vite, hot reload, everything rendered fresh).

  `@ramonda/router` is now always included for SSR (the pipeline is built on it), add-on chosen
  or not. Because the template uses new `@ramonda/core` (`renderStatic`, `requestContext`,
  `renderToString({ request })`) and `@ramonda/router` (`createRouter`, `@ramonda/router/server`),
  this release must ship core + router + create-ramonda together.

### Patch Changes

- ffa229b: Fix a reflected-XSS hole in the SSR template's error page. `server.mjs` wrote an error's
  message straight into an HTML `<pre>` on a 500, and an error can carry parts of the request
  (a malformed URL or header), so a crafted request could inject markup. The error text is now
  HTML-escaped before it reaches the page.

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
