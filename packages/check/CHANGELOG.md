# @ramonda/check

## 0.2.0

### Minor Changes

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

## 0.1.0

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

- 514c42e: `ramonda-check-context` no longer loads the TypeScript lib and `@types/*` declarations it never
  reads.

  It asks the checker exactly two things — `getSymbolAtLocation` and `getAliasedSymbol` — both of
  which are binder work over the files it walks. It never asks for a type, so `Array`, `Promise`, the
  DOM and every installed `@types` package were megabytes of parsing for nothing.

  Measured: this repo's docs app (68 components) went from **2.4s to 1.6s**, and a four-file fixture
  from 214 source files to 2 — 610ms to 3ms. The checker runs FIRST in an app's `build`, so that time
  was on every build.

  The reported result is identical: same components, same contexts, same issues. A project that does
  not compile is still `tsc`'s news to break, not this tool's.

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
