# create-ramonda

## 0.13.0

### Minor Changes

- 06d26ad: A new project scaffolds against the versions that are actually published

  `create-ramonda` was not in the last release, and its version ranges are baked at
  BUILD time — `tsup.config.ts` reads each package's version off the workspace and
  writes `~<version>` into the CLI. So the ranges a published scaffolder hands out
  are the ones that were on disk when that scaffolder was built, and they only move
  when it is published again.

  It was not, so they did not. `create-ramonda@0.12.4` was built for an earlier
  release, when `@ramonda/check` was still `0.13.0`, and comparing the ranges it
  carries against what is published now, **five of its ten first-party pins are
  behind**:

  | package           | the scaffolder hands out | published |
  | ----------------- | ------------------------ | --------- |
  | `@ramonda/check`  | `~0.13.0`                | `0.14.0`  |
  | `@ramonda/core`   | `~0.23.1`                | `0.24.0`  |
  | `@ramonda/lens`   | `~0.3.2`                 | `0.4.0`   |
  | `@ramonda/query`  | `~0.9.2`                 | `0.10.0`  |
  | `@ramonda/router` | `~0.11.0`                | `0.12.0`  |

  A tilde on a `0.x` line pins the minor, so `~0.13.0` is `>=0.13.0 <0.14.0` and
  never reaches `0.14.0`. The one that matters most is the first: a project created
  today gets the checker **where rules are warnings**, from the release whose
  headline is that every rule fails the run. The documentation says a rule refuses;
  the project you just scaffolded prints and passes, and nothing anywhere explains
  the difference.

  **The release gate cannot catch this, and that is deliberate rather than a bug.**
  `verify-versions` checks the scaffolder's first-party ranges against the
  WORKSPACE rather than against the registry, because those packages publish in the
  same run and a registry check would race them. By then the workspace is bumped
  and rebuilt, so the ranges agree. What it proves is that the built scaffolder is
  correct — not that the built scaffolder is the one on npm.

  **So the check that does catch it is a person's:** on every release, before
  publishing, confirm `create-ramonda` is in the list of packages about to be
  bumped. `pnpm changeset status` prints it.

  A minor rather than a patch: what a scaffolded project is made of changes, across
  five packages, and two of them changed behaviour.

## 0.12.4

### Patch Changes

- ccc64fe: Every package's npm page carries the same four facts, and `homepage` points at its own docs

  The README is published, so this is a change to what a reader lands on. Measured before it was
  written: of eleven published packages, five carried no licence, three named no install command
  anywhere, one had no badges, and two linked to no documentation at all. `create-ramonda` and
  `@ramonda/devtools` had no README whatsoever — their npm pages were blank.

  Those facts are now generated from the sources that already held them — the package name, its
  `peerDependencies` (required ones appear in the install line; `bguard` is declared optional and
  so does not), and `homepage`, which now points at the package's own documentation section rather
  than at the site root. npm shows `homepage` beside the package, so that is a better npm page on
  its own as well as the one source the README link is written from.

  Nothing below the generated region changed. Each README keeps its own voice, and its own headings.

## 0.12.3

### Patch Changes

- 5632f32: The documentation is at **ramonda.dev**, and everything that names it says so.

  The site was reachable only at its Cloudflare Pages subdomain, `ramonda.pages.dev`, and that address was
  written into 63 places. The custom domain is attached now, so all of them name it: `homepage` in every
  published `package.json`, every README, the URL a diagnostic tells you to open, the scaffolder's closing
  line, both `create-ramonda` templates, and `BASE` in `apps/docs/src/entry-server.tsx`.

  **`BASE` is the one that mattered beyond tidiness.** Every `canonical`, `og:url`, `og:image` and the
  whole of `sitemap.xml` and `robots.txt` are built from it — its own docblock warned that a move would
  take the canonical tags and leave the sitemap behind. Left alone, every page on the new domain would
  have told a search engine that the real page is on `pages.dev`. Verified on a real build rather than
  assumed: `Sitemap: https://ramonda.dev/sitemap.xml`, `<loc>https://ramonda.dev/…`, and the canonical
  and `og:image` tags on the built pages.

  **Two places deliberately keep the old host.** The CHANGELOGs: those are published release notes, the
  links were correct when they were written, `pages.dev` still resolves, and rewriting them would be
  rewriting history. And `.github/workflows/README.md`, where `ramonda.pages.dev` is a FACT about
  Cloudflare — the project's name is its subdomain — so the sentence stays and gains the one that was
  missing: the site is served at the custom domain, and leaving anything on `pages.dev` is how a search
  engine is told the real page is elsewhere.

## 0.12.2

### Patch Changes

- c52a3ef: **Breaking: an event handler is now `on` plus the event's own name — `onclick`, not `onClick`.**

  The old spelling was never the camelCase it looked like. Handlers were derived from the element's
  `on…` PROPERTIES and renamed to `` `on${Capitalize<name>}` ``, and the DOM's event types are single
  lowercase tokens — so what the types actually offered was `onMouseenter`, `onKeydown`,
  `onDblclick`. The natural `onMouseEnter` was a hard error and the accepted spelling was one nobody
  would guess. It survived unnoticed because every event this repository writes is ONE word, where
  capitalising the first letter happens to give the right answer.

  Handlers come from the DOM's event MAP now. Nothing is capitalised, so there is nothing to get
  wrong, and the old spellings are refused with a message naming the one to use.

  **Three things this fixes.**

  - **Five standard events had no spelling at all.** `focusin`, `focusout`, `compositionstart`,
    `compositionupdate` and `compositionend` have no `on…` property, so the old mapping could not see
    them: `onFocusIn` was a type error and lowercase `onfocusin` fell through to `any`. They are
    ordinary — `focusin` is what you reach for BECAUSE `focus` does not bubble, and `composition*` is
    IME input. All five are typed now.
  - **`on:` attaches a name verbatim**, for the events `on…` cannot spell — a custom event with a
    dash, which is what a web component dispatches by convention. `<x-thing on:my-event={…} />`.
    Before this, `on-my-event` typechecked and attached a listener for `-my-event`, an event nothing
    in the world dispatches. Measured: the handler never ran.
  - **Every handler's parameter is typed from the event map**, so `onclick` hands you a
    `PointerEvent` and `oncompositionstart` a `CompositionEvent`, with no annotation.

  **What to change.** Lowercase the event props on host elements: `onClick` → `onclick`,
  `onSubmit` → `onsubmit`, `onInput` → `oninput`. A component's own props are untouched — an
  `onSelect` you declared is yours and keeps its name. `@ramonda/form`'s `bind` follows the same
  rule: `CommonBind.onInput` and `.onBlur` are now `oninput` and `onblur`, which matters only if you
  read them off `bind` by hand rather than spreading it.

  The compiler finds every one of them: a camelCased event name is refused, and the error carries the
  spelling to write.

  **Two things found while checking the edges of this, both measured.**

  - **A stable handler was being re-attached on every render.** The node's listener map was keyed by
    the event TYPE and the previous attributes were rebuilt from it as `on` + the type capitalised —
    which matched the old spelling exactly and nothing at all after it, so every listener on the page
    was removed and re-added on every pass. It is keyed by the attribute name now, so nothing is
    rebuilt and nothing can be ambiguous. Two renders of a button with two handlers: `adds: []`,
    `removes: []`.
  - **`@Host`'s props are typed now.** They were `Record<string, unknown>`, which made the host the
    one place a camelCase handler still attached quietly — and typing them found exactly that in this
    repository's own docs app. A `@Host` tag is also constrained: a platform element from
    `JSX.IntrinsicElements`, or a custom one, which by the platform's own rule carries a DASH.
    `<my-widget>` can be upgraded; `<mywidget>` is an `HTMLUnknownElement` for ever and is usually a
    misspelling.

  **`@onElement` takes the event's own name and always did**, so `@onElement("my-event")` has always
  worked. What it now refuses is the two namings that are PROVABLY not an event — with the fix in the
  error, the way the JSX types do it:

  - `@onElement("onclick")` — the JSX attribute written where the event belongs, and the likelier
    mistake now that the attribute IS `onclick`. Refused only when what follows `on` is an event this
    target has, so a custom `online` or `once` is untouched.
  - `@onElement("MouseDown")` — `addEventListener` is case-sensitive, so it never fires. Refused only
    when the lower-cased name is one of this target's events, which leaves a custom `DOMSomething`
    alone.

  Everything else still passes, and that is the design rather than a gap: a custom event may be called
  anything, so `clik` cannot be refused without refusing `save` and `my-event` with it.

  **`@ramonda/check`** kept up in two places, both of which would have gone quiet:
  `client-only-request-read` recognised a handler by the CAPITAL after `on`, and
  `click-with-no-keyboard-path` looked for `ondoubleclick`, which is not a DOM event and never
  matched anything.

## 0.12.1

### Patch Changes

- bb5f5d1: The SSR template types `import.meta.env`, and a comment that my own change made false is corrected.

  The SPA template gets `import.meta.env`'s type from `/// <reference types="vite/client" />`. The SSR
  template has no Vite types to reference, so it now declares `ImportMetaEnv` and `ImportMeta` in its
  `global.d.ts` — which is already in its `include`, so the declaration is actually compiled. That is the
  file to add your own `RAMONDA_PUBLIC_` names to.

  **And a comment that stopped being true.** `spa/src/vite-env.d.ts` explained the asymmetry between the two
  templates as "the SSR template is built by esbuild" — which was the reason it had no `import.meta.env` at
  all. It has one now, because `@ramonda/build`'s esbuild half defines the object and every public name. The
  only asymmetry left is CSS, and the comment says so.

  `global.d.ts` also says what `__DEV__` is for, which it did not: it is what `@ramonda/core` itself is
  compiled against, which is why the build defines it. For an app's own code `import.meta.env.DEV` says the
  same thing, is what the documentation uses, and reads alike under Vite in development and esbuild in
  production — either is a literal at build time, so either compiles a development-only branch out.

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

## 0.12.0

### Minor Changes

- a35572e: A scaffolded SSR project sets a title and a description on every page.

  The template used none, which made a poor starting point for the one kind of project where it
  matters most: server rendering earns its cost with readers who never run your JavaScript — a
  crawler, a link preview, a reader mode — and what they see is what is in the file. A generated
  project shipped every route under the shell's one `<title>`.

  Each page now has its own `Head`, including the dynamic route, which builds its title from the
  param. It is also what makes the head reachable by a check: the template exercising none is why a
  render that silently dropped it went unnoticed until it was measured by hand.

## 0.11.0

### Minor Changes

- ccb7629: A prerendered page keeps its named portal targets, and a hand-assembled shell can place them.

  `Portal`'s plan was that a portalled subtree should be indistinguishable from a normally mounted
  one — full SSR into any named target, state restored on hydration, `list()` working inside it.
  Every part of that had unit tests and **not one application used it**, in this repository or in the
  docs site. Rendering one through a real build found two holes, both silent:

  **`renderStatic` dropped `portals`.** `renderPage` returns them; the build-time render that bakes a
  static page did not, and did not reset its containers before rendering either. A prerendered page
  therefore lost every named portal block — the file looked correct, and the client built the subtree
  a SECOND time on hydration because there was no container to adopt. Only a real static build could
  show it.

  **A hand-assembled shell had nowhere to put them.** `renderDocument` emits a container per target,
  but an app that writes its own shell — which the SSR template and this repository's playground both
  do — had no supported way to. `fillDocument` now takes `portals` and fills a `<!--portals-->` marker:

  ```js
  res.end(fillDocument({ template, html, title, head, portals }));
  ```

  ```html
  <div id="app"><!--ssr--></div>
  <!--portals-->
  ```

  A shell with blocks to place and no marker **throws**, naming the targets. That is the one missing
  marker not returned quietly: a missing `<!--ssr-->` gives a page with no app in it, which announces
  itself, while a dropped portal gives a page that looks perfect and then duplicates a modal in the
  browser.

  The markup matches `renderDocument` exactly — same attribute, same escaping, same position after
  the app root — because the two disagreeing is itself a way to make hydration rebuild.

  **A scaffolded SSR project ships the head it renders, and has somewhere to put a portal.**

  It rendered with `renderToString`, which hands back the body and nothing else — no title, no meta,
  no portal blocks. A generated project that added a `<Head>` therefore shipped pages with **no title
  and no description**, invisible to exactly the crawlers server rendering exists for. Measured on a
  scaffolded project, not inferred. It now renders with `renderPage`, and the shell carries
  `<!--head-->` and `<!--portals-->`.

  The portals marker is there before anything uses one, on purpose: `fillDocument` refuses a render
  that collected blocks with no marker, so without it the first `<Portal target={portalTarget(…)}>`
  someone writes breaks their build, and the fix is one line in a file they had no reason to open.

  Its ISR entries now cache the **whole document** rather than the body. Filling the shell at send
  time works until the shell changes under a cached page — and with a head collected per page, the
  head is what goes stale first: one page's cached entry served with another's title.

  `fillDocument` also stops taking an EMPTY title literally. `renderPage` returns `""` when no `Head`
  set one, which is a report of absence; writing it emptied the shell's own `<title>`, and a
  scaffolded project shipped `<title></title>`. Found by building one.

  **A finished `renderPage` no longer leaves a page's portal containers standing.** It resets the head
  in its `finally` for a stated reason — keeping a long-lived server from carrying one request's tags
  into the next — and portals were missing it, though they hold whole DOM subtrees rather than a few
  tags. Measured: a container still held the last page's markup after the call returned, while
  `renderStatic` cleared both.

## 0.10.0

### Minor Changes

- 01c1f3a: New package: `@ramonda/server` — the plumbing a server render needs, so an app stops writing it.

  A DOM to render into, and the document the render goes into. Routing stays where it is: the route
  plan, the ISR cache and the render modes are `@ramonda/router/server`, and this package knows
  nothing about routes.

  ```js
  import { fillDocument, installDom, parseCookies } from "@ramonda/server";

  const dom = installDom(`http://localhost:5173${req.url}`);
  try {
    const { html, title, head } = await render({
      cookies: parseCookies(req.headers.cookie),
    });
    res.end(fillDocument({ template, html, title, head }));
  } finally {
    dom.close();
  }
  ```

  **It exists because the copies drifted, and one of them shipped.** Three separate faults, all the
  same shape:

  1. A project's `server.mjs` and its `scripts/prerender.mjs` each had a DOM installer. The server was
     moved from jsdom to linkedom; the prerender step was not. The build bundled successfully and then
     died at prerender with `ERR_MODULE_NOT_FOUND`.
  2. An unescaped `<title>` and a `$`-sequence corruption were found and fixed in ONE copy of the
     shell fill. **The scaffolded template shipped both until now:** `String.prototype.replace` reads
     `$&`, `` $` `` and `$$` in the replacement as patterns, so a page rendering "Save $$ today" put
     the marker back into its own output and still answered 200.

  A scaffolded SSR project now depends on `@ramonda/server` and carries no `installDom.mjs` of its
  own, so the next fix to any of this reaches projects that already exist.

  `linkedom` is a DEPENDENCY, not a peer, so a project that installs this names no DOM library at
  all. It was a peer for one afternoon, and the scaffolder put linkedom in `devDependencies` — which
  made `npm ci --omit=dev` produce a project that built and then died on `ERR_MODULE_NOT_FOUND`, the
  very fault being extracted. A peer is right when the consumer must choose the copy; nothing here is
  shared, and `installWindow` is already the seam for bringing your own.

  **`installWindow(url, window, { navigation })`** is the seam for a DOM you built yourself — a jsdom,
  to measure one implementation against the other, or to prerender a whole site on one document.
  `navigation: "dom"` takes that DOM's own `location`/`history`, so `pushState` between pages moves
  the URL; the default builds both from `url`, which is what a server answering one request wants.

  It is an argument rather than something detected, and that is measured rather than preferred:
  linkedom's window falls through to `globalThis` for anything it does not define, so the window built
  for the SECOND request reports the first request's location as its own — to `hasOwnProperty` as
  well. A "use the DOM's if it has one" rule reads as true from request two onward and serves every
  visitor the first URL's page.

### Patch Changes

- cac0387: A scaffolded SSR project can prerender again.

  `server.mjs` was moved from jsdom to linkedom and the scaffolder's dependency list moved with it —
  but `scripts/prerender.mjs` was left importing jsdom, which now arrives only with the `testing`
  add-on. Without that add-on the project installed, type-checked, built both bundles, and then died
  on `ERR_MODULE_NOT_FOUND` at the prerender step.

  The two installers are now one file, `installDom.mjs`, imported by both. One file cannot drift from
  itself.

  Found by scaffolding against the registry and running the build, which nothing automated had done.
  A test now reads every `.mjs` the template ships and fails if it imports a package the scaffolder
  does not install — the general form of this fault, rather than this one instance of it.

## 0.9.0

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

- 58693b4: `ramonda-check-bundle` now ships, and a scaffolded project runs it.

  Ramonda's decorators are TC39 syntax that no engine can parse, so the bundler has to transform them
  away. Which it does is decided by one line — `target` — and `esnext`, the value that reads like a
  modernisation, is the one that leaves them in. The build still succeeds, prints no warning, and
  emits a file that dies with `SyntaxError: Invalid or unexpected token` on the first page load.

  This repository has been guarded against that for a while; a project scaffolded with
  `npm create ramonda` was not. Both now end their `build` with `ramonda-check-bundle`, which parses
  every emitted file and fails the build instead of the browser.

  - `@ramonda/check` gains a second binary, `ramonda-check-bundle <dir-or-file>...`. Nothing about
    `ramonda-check` changes.
  - Both templates end `build` with it, and both `vite.config.ts` files now say what `target: "es2022"`
    is for — the setting was already correct and completely unlabelled, which is how it got removed
    the first time.

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
