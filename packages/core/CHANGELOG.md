# @ramonda/core

## 0.5.0

### Minor Changes

- 3c344f9: `requestContext()` now works in the browser — and opting a value into the client is explicit.

  **Fixes a real gap:** nothing installed a request scope on the client, so a component that read
  `requestContext()` directly in `render()` worked on the server and **threw during hydration**
  (`"requestContext() was called outside a render"`). `hydrateRoot` and `bootstrap` now install a
  browser scope, so such a read returns a value (if it was exposed) or nothing — never a crash.

  **Nothing travels unless you say so.** A key opts in:

  ```ts
  export const currentUser = requestKey<User | null>("currentUser", {
    exposeToClient: true,
  });
  ```

  Exposed values ride one blob on the root element (`data-ramonda-request`), and the browser reads
  them back through the same `requestContext().get(key)`. Everything else stays on the server:
  **cookies and headers can never be exposed** (they are the server's, and an httpOnly cookie is
  invisible to JS anyway), and a key that did not opt in does not travel. Reading any of those in
  the browser returns nothing and reports the new **RMD025** in development, rather than throwing —
  breaking the page would be worse, and a real divergence is already reported by hydration.

  Also: in the browser `requestContext().url` follows the address bar, so it stays correct after a
  client-side navigation instead of freezing at whatever the server rendered.

  Most apps need none of this — reading the request in `@create` and keeping the result in `@state`
  already travels, because `@create` is skipped on hydration and the state is restored from the page.
  `exposeToClient` is for when several components read the same value straight from the context.

- 621eaeb: `@Host`, `@onElement` and `@shouldUpdateOnPropsChange` are now refused on a hook by **TypeScript**,
  not only at runtime — and the two that failed badly now fail clearly.

  Before: `@Host` on a hook was **silently ignored** (the metadata went to a class no render path
  consults), and `@onElement` died with `Cannot read properties of undefined (reading 'enhancedNode')`
  — an error naming nothing the author wrote. Only `@shouldUpdateOnPropsChange` explained itself, and
  none of the three was a type error.

  Now each is refused twice: the type rejects it at the decorator, and a build with no types throws at
  construction with a message that says where the decorator belongs instead.

  ```
  [Ramonda] @onElement is for components, not hooks. It binds a listener to the component's
  host element, and a hook has no element of its own. Move the listener to the component that
  uses <Listening />, or use @onWindow / @onDocument, which work on both.
  ```

  Everything else in the decorator set works on a hook — measured, not assumed: `@state`, `@persist`,
  `@compute`, `@memoizedHandler`, `@create`, `@mount`, `@destroy`, `@updated`, `@watchProp`,
  `@deferHydration`, `@onWindow`, `@onDocument`, `@interval`, `@timeout`, and your own subscription
  decorators. A new [decorator table](https://ramonda.pages.dev/reference/decorators) answers all
  three questions at once: where each runs, what it goes on, and whether it may repeat.

- 4850a4e: A missing context provider (`RMD003`) is now reported when the consumer **mounts**, not when a
  value is first read — and nothing has to be declared to get it.

  The information was always in the hook: `this.use(ThemeConsumer)` names the context, and the
  consumer resolves its provider once, at construction. So the answer exists at mount. Waiting for a
  read gave the same answer later, and for a value read only down a branch nobody clicks, never at
  all — which is the fault worth catching: the page renders, the default fills in, nothing looks
  wrong.

  The report names the component the provider has to go above:

  ```
  [RMD003] Context consumed without a provider above it
  <Panel /> mounts ThemeConsumer with no Provider on any ancestor, so every key it reads
  gets the default below.
  ```

  `createContext` takes one new option, for the case where the default IS the answer:

  ```tsx
  const [ParamsProvider, ParamsConsumer] = createContext(
    { params: {} },
    { label: "RouteParams", optional: true }
  );
  ```

  The flag belongs to the context, not to each consumer — whoever wrote `createContext` is the one
  who knows whether the default is a real answer or a stand-in for something missing, and they say it
  once. The router's `params` context is marked `optional`, because a nav bar beside the outlet
  legitimately has no matched route above it. `@ramonda/check` honours the same flag, so the static
  and runtime checks agree.

  Development-only, as before: a production build reports nothing and reads exactly the same values.

### Patch Changes

- e932acf: Diagnostic severities now follow one rule: **error means the end result is wrong; warning means the
  result is the same and the app just did more work to get there.**

  That matters because the devtools panel raises its alert only for errors, so a fault that produces
  wrong output has to be one. Re-graded to **error**:

  - **RMD003** — context consumed with no provider above it. The consumer silently gets the default,
    so someone reads and acts on data that is not what the app meant to show.
  - **RMD010** — a default host the parent does not allow: the browser rearranges or deletes the
    markup, so the page is not what was written.
  - **RMD016** — a component updating while detached: `@destroy` never ran, its timers and listeners
    are still live, and every render goes into nodes nobody can see.
  - **RMD017** — a deferred hydration that never resumed. The page looks finished but that subtree
    never becomes interactive.
  - **RMD021** — a clock or random read in a `@compute`: the value freezes, and the reader is shown a
    number that stopped moving.
  - **RMD023** — components built from an array with no keys: items are matched by position, so state
    lands on the wrong row.
  - **RMD025** — per-request data read in the browser: the reader gets nothing where the server had a
    value.

  Still warnings, because the outcome is unchanged and only the cost is not: RMD008 (a write after
  unmount is dropped, and there is no page left to update), RMD020, RMD022, RMD024.

  The rule is now stated in the diagnostics reference, and on the type that carries it.

## 0.4.0

### Minor Changes

- f200db8: Add `renderStatic(vnode, url)` — the build-time render that PROVES a route holds no
  per-request data before it is baked.

  It renders with the request context poisoned (`requestContext()` reads throw and are
  recorded), and returns either `{ html }` — safe to bake — or `{ blockedBy }` naming the
  per-request field that was read, meaning the route cannot be prerendered and must fall back
  to per-request rendering. This is the guard that makes opt-in SSG safe: a page that reads a
  cookie, header, or seeded value literally cannot be turned into static HTML, so one visitor's
  data can never end up in another's cached page.

  It catches reads wherever they happen — `render()`, `@create`, and even an async `@mount`
  (whose throw is swallowed by the render drain, so the read is _recorded_ on the scope and
  checked afterwards). `url` stays readable throughout (it is the page identity). Sequential by
  design (a build renders one page at a time) — not for serving concurrent requests.

- f8e7671: Add `requestContext()` — per-request data with a build-time safety guard.

  Per-request data (cookies, headers, the signed-in user) is now reachable only through
  `requestContext()`, so a static build can PROVE a route touched none of it before baking:

  - `requestContext().url` is always safe (it is the page identity).
  - `requestContext().cookies` / `.headers` / `.get(key)` return real values on the server and
    the exposed subset on the client, but **throw during a static build** (`RequestReadDuringBuild`).
    A page that reads the request literally cannot be prerendered, so one user's data can never
    end up in another's cached HTML.
  - `requestKey<T>(label)` declares a typed per-request slot; `seedRequest(key, value)` fills it
    on the server before the render; the tree reads it with `requestContext().get(key)`.

  This is the safety core for the upcoming per-route SSG/SSR/ISR work (default SSR, opt-in
  prerender guarded by this poison). New exports: `requestContext`, `requestKey`, `seedRequest`,
  `RequestReadDuringBuild`, and the `RequestContext` / `RequestKey` / `RequestCookies` /
  `RequestMode` types.

- 32c9f41: `renderToString(vnode, { request })` — per-request server renders, so `requestContext()`
  returns real values.

  Pass `{ request: { url, cookies?, headers?, values? } }` and the render runs in "server" mode:
  `requestContext().cookies` / `.headers` / `.get(key)` return the request's real data instead of
  throwing. This is the dynamic (SSR) counterpart to `renderStatic`'s poisoned build render.

  The scope is live only across the render's **synchronous** section (the same window and the same
  concurrency guarantee as `renderEnv` — two concurrent requests must not share it across an
  `await`). So read `requestContext()` **synchronously**: in `render()`, in `@create`, or before an
  `@mount`'s first `await`. The idiomatic pattern needs nothing more — read the request in `@create`
  and store it in `@state`; `@create` is skipped on hydration and the `@state` is restored from the
  page's state blob, so the client never re-reads the request and there is no separate request blob
  to ship. New types: `RenderToStringOptions`, `ServerRequestInit`.

## 0.3.0

### Minor Changes

- cb289b6: Edit a `@state` value from the panel.

  **✎** on a state row opens the value as JSON in place: Enter applies, Escape abandons, and a
  multi-line value takes ⌘/Ctrl+Enter so plain Enter stays a newline. Invalid JSON never reaches the
  app — the parse happens first and the row says what was wrong.

  The write side of the bridge is deliberately narrow: **one field, addressed by a handle the last scan
  handed out, and only when that field is `@state` or `@persist`.** There is no way through it to an
  instance, a method, or a prop. A handle from an older scan is refused rather than landing on whatever
  now occupies that slot.

  Two limits are the framework's rules, not the panel's, and both are stated in the UI:

  - **You edit the whole field.** A signal holds a value, not a proxy, so mutating inside an object
    notifies nobody: "change `user.name`" has to become "assign a new `user`". The panel is held to the
    same rule as application code.
  - **Props have no pencil.** They are owned by whoever rendered the component and assigning to one
    throws in every build (RMD004 / RMD015). A box that pretended otherwise would either throw or look
    like it had worked until the next render put the old value back. Same for a hook's props, which come
    from its owner's callback. Core refuses the write; the panel does not offer it and says why if it is
    attempted.

  A value that cannot survive a round trip through JSON — a function, a `Map`, a DOM node — gets no
  pencil either, rather than a box that fails on Enter. The write itself goes through the ordinary
  setter, so the signal notifies, the component rebuilds, `@updated` runs, and a diagnostic fires for a
  non-serializable value, exactly as if the app had assigned it.

- 066dcf9: `</>` on any row in devtools opens that component's definition in your editor.

  This closes the flow the navigation work was for. You could already point at something on the page,
  find its component and focus it — and then you alt-tabbed and searched for the class by name. That
  was the last manual step, and the most frequent one.

  **Where the location comes from, and why it needs nothing from you.** The framework reads it off the
  stack the first time a component or hook is constructed. That was measured before it was built on: a
  subclass appears in a stack by name even when it declares no constructor of its own, and the frame's
  position is the class declaration. So there is no build plugin to install, no JSX transform to switch
  to, and no decorator a component has to carry — a bare `class Foo extends Component` is located like
  any other. One `Error` per class, cached, in a development build only.

  The alternatives were each worse: a JSX transform gives the call site (`<Foo />`) rather than the
  definition, and esbuild only injects source for the automatic runtime, which this framework does not
  use; a build plugin would be accurate and would also be a thing every app has to configure.

  **Opening goes through the dev server**, not through a `vscode://` link: Vite's `/__open-in-editor`
  hands the file to whatever editor is running on the machine that serves the app, so nothing has to be
  registered or configured, and the browser never needs the absolute path. Without that endpoint — a
  custom server — the location is copied to the clipboard and the log says so, because a button that
  silently does nothing is worse than one that hands you something to paste.

  **The position is resolved through the module's own sourcemap**, and that turned out not to be
  optional. A stack reports the file the engine loaded, and `Error.stack` is never sourcemapped
  (browsers apply sourcemaps when _displaying_ a stack, never in the string). Measured against Vite 7
  serving a real page: a class declared on **source line 20** appears on **served line 51**, because
  esbuild lowers standard decorators and prepends a preamble. Thirty-one lines is not a rounding error
  — it is a button that looks broken.

  Vite serves each module with an inline map, so the map is already in the file the browser has
  cached: fetch the module, decode the mappings, look up the segment. Verified end to end against a
  live dev server — served 51 → source 20, exactly the declaration. The file name comes from the map
  too, which is what keeps a bundled development build from opening the bundle instead of the source.
  Everything fails towards the unresolved position, which still opens the right file.

- ddd4a63: A profiler: what one commit cost, and which components it rebuilt.

  The framework's central claim is about the cost of a commit — a render being a few percent of it,
  access tracking turning nine renders into three, structural sharing turning 272 ms into 1.3 ms. Every
  one of those numbers was measured in a test, and none of them was ever visible in the panel. An app
  author could not check the claim against their own app, which is the only place it matters.

  **A commit here is one drain**, not one build: everything a single state change rebuilt, including the
  effects and `@updated` bodies it scheduled. Timing builds and summing them would leave out the diff,
  the DOM and the post-commit flush — the part that hurts.

  **Off until you press record.** A commit is the hottest path in the framework, so sampling it always
  would be a tax on every development build. Measured — and measured properly, because the first attempt
  ran off-then-on once each and reported recording as _faster_, warm-up drift being larger than the
  effect. Alternating runs, medians of seven rounds of 200 commits over a 51-component tree:

  ```
    off        253.9 ms
    recording  263.0 ms   → 3.6%
  ```

  The `PROFILE` tab lists commits newest first with their duration, and under each one the components
  that made it up with their share. The **count** is usually the more useful number: `Row ×40` after
  changing one row is not a slow component, it is forty renders that did not need to happen. A list
  rather than a flamegraph, deliberately — a flame chart of a flat drain is a picture of one bar.

### Patch Changes

- 8d76b4e: A check that a workflow does not bypass turbo — the gap the docs deploy fell through.

  `pnpm check` and CI both go through turbo, so both were green while `deploy-docs.yml` ran
  `pnpm --filter @ramonda/docs build` directly and skipped the `content` task that `build` declares in
  `dependsOn`. The gap was never in _what_ is built; it was in _how a workflow asks for it_, and nothing
  looked at that.

  `scripts/check-workflows.mjs` reads `turbo.json` for the tasks that have dependencies, scans the
  workflows, and refuses to see one of those invoked as a package script. Narrow on purpose: only a task
  with a `dependsOn` can silently lose a step this way.

  It runs in `pnpm check` and in CI, its self-test first — and the self-test earned its place immediately.
  The first version anchored its patterns to the start of the line, which in YAML sits after `run:`, so it
  matched nothing and pronounced the still-broken `deploy-docs.yml` clean. The self-test now checks both
  directions: the offending line is caught, the corrected one is not.

- 772557f: Why the devtools import lives in your app and not in `bootstrap`, with the measurement.

  Asked: the one line every app writes — `if (import.meta.env.DEV) void import("@ramonda/devtools")` —
  would be cleaner inside `bootstrap`. It cannot go there, and the reason is now recorded in core and on the
  devtools page rather than left as folklore. Measured on an app that has **not** installed the panel, which
  is most apps:

  ```
  vite build   →  "[vite]: Rollup failed to resolve import "@ramonda/devtools""   the build FAILS
  esbuild      →  bundles, leaving import("@ramonda/devtools") in the output      fails at runtime
  ```

  So a literal specifier inside core would break `vite build` for everyone who does not use devtools, and
  ship an unresolvable bare specifier for everyone who uses esbuild. Core's speculative import therefore
  keeps its **variable** specifier plus `@vite-ignore`, which no bundler rewrites — meaning the browser
  would have to resolve a bare specifier itself, and it cannot.

  Only the app can load the panel: it is the one that knows the package is installed, and its bundler is the
  one that can resolve it. Nothing changed in the code; what changed is that the next person to ask gets an
  answer with numbers instead of an assurance.

- ae22ab7: The docs deploy built nothing, because it bypassed the task that generates the content.

  ```
  ✘ [ERROR] Could not resolve "./generated/content"
  ✘ [ERROR] Could not resolve "./generated/page-loaders"
  ✘ [ERROR] Could not resolve "./generated/preloads"
  ```

  `content` was moved out of the docs build script and made a turbo task, to stop two processes rewriting
  `src/generated/` while `tsc` read it. `build` picks it up through `dependsOn` — but only when turbo is the
  one calling. The Cloudflare workflow ran `pnpm --filter @ramonda/docs build` directly, so nothing ever
  generated the directory.

  It goes through `turbo run build --filter=@ramonda/docs` now. And because the symptom named the wrong
  thing — three missing imports read as a broken repository rather than a skipped step — the docs build
  begins with one `existsSync` that says which step to run. Reproduced by deleting `src/generated/` and
  watching both the old failure and the new sentence.

- efed944: The documentation no longer teaches a decorator that does not exist.

  `@effect` was removed in 0.1.0, and the word stayed behind: the root README listed it among the
  decorators, core's README had a table row for it, `@ramonda/query`'s README explained mutation rollback
  by comparing it to "the cleanup contract `@effect` uses", and the sidebar group was called _Lifecycle and
  effects_. A reader following any of those looks for something that is not there.

  The `/concepts/subscriptions` page also stopped explaining itself as a migration. Its "There is no
  `@effect`" section was written for someone who had used the old decorator; it now answers the question a
  reader actually arrives with — _where did `useEffect` go_ — with a table from what you want to the name it
  has here, and keeps the reason: an effect is defined by its dependencies rather than its purpose, so one
  decorator would have to be all four of those things, and which one it was would depend on what its body
  happened to read that render.

  Elsewhere "effects" was the runtime's own vocabulary leaking into prose a reader cannot look up ("after
  this commit's `@mount`s and effects"); those say _subscriptions_ now.

- 43c02cb: Two committed failures that `turbo run` cannot see, and a `pnpm check` that would have caught them.

  The branch was green on `turbo run check-types test build` while carrying a sparse array in
  `apps/playground-ssr/server.mjs` (`?? [, target]`, which oxlint's `no-sparse-arrays` refuses) and a
  misformatted `apps/playground-core/src/pages/QueryPage.tsx`. Both would have failed `ci.yml`.

  The reason turbo missed them: **no app under `apps/` has a `lint` script**, so `turbo run lint` covers
  `packages/` only — and `format:check` is not a turbo task at all. Both are root scripts, and CI runs the
  root scripts. `pnpm check` now runs the same four in the same order, and the gap is written down in
  `.github/workflows/README.md` rather than left to be rediscovered.

  The parse rewrite was checked against the original on seven inputs, including the no-colon and
  `src/x.tsx::9` cases, before replacing it.

- ad517f7: The documentation now says why there is no post-commit `@watchProp`.

  It is the obvious sugar — "run this after the commit, but only when this prop changed" — so its absence
  was reading as a gap. It is a decision, and `/concepts/lifecycle` now gives the three reasons: it would
  be strictly narrower than `@updated` (props only, not a hook's state, not context, not any other cause
  of a commit — which the DOM cases usually are); its state write could not fold into the render the way
  the in-build one does, so the framework would have to start comparing your props for you; and the `if`
  it would replace answers "is the DOM already how I want it", which only the author knows.

  `@watchProp` before the render, `@updated` after it, one field comparison for the guard. No new API.

- 2bdb5f7: The docs build died on CI's first line, and the cause was the Node version rather than the code.

  ```
  SyntaxError: The requested module 'node:fs' does not provide an export named 'globSync'
  ```

  `fs.globSync` landed in Node 22. CI pins Node 20, the machine that wrote it runs 24, so every local run
  was green and the first push was not. The diagnostics-coverage check now walks with `readdirSync`
  (`withFileTypes`, Node 10), verified to find **the identical file set** — 81 files in core, 19 in query —
  and then run under Node 20.20.2 itself, which is the exact version CI installs.

  The whole gate was re-run on that Node with `--force`, because turbo will otherwise replay results cached
  from a different runtime and report a pass without running anything: **29/29, 0 cached**.

  `pnpm check` now begins with a preflight that reads the pinned version out of the setup action and warns
  when the local major differs. It warns rather than fails — a newer Node is not a mistake, and stopping
  work over it would be. What it buys is that the next time CI breaks where local passed, the first guess is
  already on screen.

- 9e29131: The SSR smoke test asserted that the machine has an editor, which a CI runner does not.

  It called `__open-in-editor` and required a `200`. Opening a file needs an editor, and `launch-editor`
  finds one from `$EDITOR` or by guessing from the process table — so a developer with an IDE running got a
  `200` and the runner got `500 no editor found`.

  What the endpoint is for is resolving the path, and an unresolvable path is refused with `422` **before**
  any launch is attempted. So reaching the launch is the proof, and a `500` saying "no editor found" now
  passes. To keep that from becoming "accept anything", the test makes a second request for a file that does
  not exist and requires the `422` — deleting the server's `existsSync` guard turns that assertion red,
  which is how it was checked rather than assumed.

  Reproducing a runner locally needs `ps` shadowed as well as `$EDITOR` cleared, since the process-table
  guess finds your editor either way. That recipe is in `apps/playground-ssr/README.md`, and the whole gate
  was re-run under it: 29/29, 0 cached.

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

## 0.2.0

### Minor Changes

- 2562896: A context consumer is no longer an empty node in devtools, and the pair is named Provider/Consumer
  throughout.

  **What a consumer reads is now visible.** A consumer holds no state and no props — every value it
  exposes is an accessor over the provider's signals — so it appeared in the panel as a node with
  nothing in it: the emptiest thing in the tree being the hook whose entire job is reading. It now
  reports, under `Reads from context`, the keys it is subscribed to with their current values, and
  names the keys it has never read.

  The catch, and the reason the consumer answers for itself rather than the panel walking its
  properties: **reading is subscribing.** A consumer's getter attaches a listener on first read, so a
  panel that read every key would silently widen what the owning component re-renders on. Only
  already-subscribed keys are read, where the subscribe branch is a no-op. There is a test that
  changes a key the consumer never reads and asserts it did not rebuild — inspecting must not change
  behaviour, and here the ordinary read does.

  Seeing which keys a consumer actually reads is worth it on its own: it is the fine-grained
  subscription made visible, the difference between "this one wakes on `color`" and "on anything in
  the theme".

  **Naming.** The docs already destructured `[ThemeProvider, ThemeConsumer]` while the framework's own
  source, tests and playground said `ThemeContext` — and devtools, which labels the hook
  `${label}Consumer`, disagreed with the code in front of you. `Consumer` everywhere now. It is also
  the more accurate name: the pair is a provider and a consumer, and unlike React's context object
  there is nothing here to take a `.Provider` off. Only local destructuring names changed; no API did.

- 8caeaf5: `RMD024` — a `@compute` that recomputes over and over and keeps producing the same answer.

  A compute is invalidated by the signals it READ, so if one of them is a rebuilt reference — an
  array literal in a hook's props bag, a fresh object handed down as a prop — it recomputes on
  every pass and answers the same thing. Its cache does nothing, and the work is silent: the
  answer is correct, so nothing looks wrong.

  **Neither neighbouring check can see it.** RMD020 renders twice, and inside one strict render
  the compute is _cached_ between the two calls, so both get the same value. RMD022 compares two
  props bags, but skips a prop declared with `@StableProps` or wrapped in `stable()` — and a
  compute reading a component's prop is outside its reach entirely.

  Three consecutive equal recomputes, not one: a dependency moving while the answer happens not
  to change is ordinary, and reporting that would put a warning on correct code. One bounded
  `valueEqual` per recompute, development only.

  Keyed by instance and member rather than by the cache, because two instances of one component
  are two questions and one churning says nothing about the other. The test for that asserts the
  report count, not its presence.

  The honest limit is stated in the docs: a compute reading _only_ something non-reactive — a
  counter, `Date.now()` — is never invalidated, so it never recomputes and is never seen. Nothing
  can report a value nobody asked for again.

  Also in this release: **`@ramonda/devtools` is type-checked.** It had no `tsconfig.json` and no
  `check-types` script, so 600+ lines of TypeScript that ship to users were checked by nothing;
  `turbo run check-types` now covers 8 packages instead of 7. Found while looking into whether
  five packages needed `@types/node` — none of them did (the `node:` match in the router was
  `vnode:`), so five dead dependencies were not added, and this was the real hole behind that
  note.

### Patch Changes

- 38274cd: The development-only browser setup is guarded on `customElements`, not on `document`.

  A server render can have a `document` — this repo's own SSR playground gives its Node process a
  jsdom one — so `typeof document !== "undefined"` never meant "browser". It did not matter while
  every browser API in that block sat inside the dynamic import's `.then()`, which fails on the
  server. Moving the devtools mount out of that callback put `customElements.whenDefined` on the
  top level, and the SSR playground died at import:

  ```
  ReferenceError: customElements is not defined
  ```

  The panel IS a custom element, so the registry is the capability that actually has to exist.
  Guarding on what the code needs, rather than on a proxy for the environment, is the fix.

  **And the reason nothing caught it: `apps/playground-ssr` had no `test` script**, so CI ran
  nothing against the one thing in this repo that is a real server. It has one now — a smoke test
  that spawns the built server as a child process and asks it for `/`, checking the root element,
  server-rendered content and a hydration blob. Deliberately shallow and deliberately real: no
  jsdom substitute, no mock. `/` rather than `/products`, because that route fetches from a public
  API and a smoke test must not depend on the network.

  Verified to have teeth: with the old `document` guard restored, it fails with
  `the server exited with code 1 before serving anything` and prints the `ReferenceError`.

## 0.1.0

### Minor Changes

- b208b86: `_`-prefixed methods are bound like any other, `@Host` infers its class, and class
  decorators are PascalCase.

  **Method binding no longer skips `_`-prefixed methods.** The skip was a performance
  opt-out — internal by convention, so binding was not paid for it — and the convention is
  not this framework's to claim. typescript-eslint's `naming-convention` rule is commonly
  configured with `leadingUnderscore: "require"` for private members, so a project with that
  rule wrote `private _apply()` and got a method that silently did not bind:
  `onClick={this._apply}` then lost `this`, with no error and no diagnostic. A lint rule
  chosen for unrelated reasons broke the framework's central promise about methods.

  Nothing internal needed it, which was checked rather than assumed: there are no
  `_`-prefixed members on `Component.prototype` or `Hook.prototype`, `_componentInstance` and
  `_componentDefinition` live on DOM nodes, and `Context`'s `_subscribedKeys` is a field —
  fields are never bound. (The comment justifying the skip pointed at "the note in
  Component.ts". There was no such note.)

  And it bought little. Measured per instance, binding every method against binding all but a
  third of them: 3 methods 41 ns, 5 methods 10 ns, 8 methods 84 ns, 12 methods 212 ns — a
  fifth of a millisecond across a thousand rows, at twelve methods. If an opt-out is wanted
  back it should be an explicit `@unbound` decorator, which says what it does where it does
  it and cannot be triggered by a lint rule.

  **`@Host` needs no type annotation and no type argument.** `self` in its props callback, and
  `props` in its tag callback, are now typed from the decorated class:

  ```tsx
  @Host("section", (self) => ({ "data-label": self.label })) // self is Card
  class Card extends Component<{ label: string }> {}
  ```

  The mechanism is worth recording: both parameter types are CONDITIONAL types over the class
  (`InstanceOf<C>`, `PropsOf<C>`), and a conditional is not an inference site — so TypeScript
  cannot resolve `C` from the decorator's arguments and defers until the decorator is applied,
  where the class supplies it. The obvious shape (a type parameter sitting directly in the
  callback's parameter position) fixes it to `unknown` from an unannotated arrow before the
  class is ever looked at, which is why this used to need `(self: Card)` spelled out.

  **`@stableProps` is renamed `@StableProps`** — class decorators are PascalCase (`@Host`,
  `@StableProps`), member decorators are camelCase (`@state`, `@compute`, `@watchProp`). The
  casing is the only thing that tells you where a decorator goes, and the two groups are used
  in different places. Documented in the API reference.

- 465918f: `this.use(Hook, props)` now infers a **generic** hook's type parameter from the props callback.

  `use` took one union parameter (`props: Q | R` with `R extends (bag: this) => Q`), which cannot type a generic hook class: `HookProps` is `Record<string, any> | undefined` and a function is assignable to that, so with no fixed candidate for `Q` from the constructor, TypeScript inferred `Q` as the callback itself. A hook like `Query<TData>` came out as `Query<unknown>`. The callback now has its own overload, so `Q` is inferred from the return type — and a type parameter that only appears in a prop (`fetch: () => Promise<TData>`) follows from it with nothing declared at the call site.

  **Breaking, in one narrow way:** the callback's parameter is typed `never`, so an _unannotated_ one no longer type-checks.

  ```ts
  // before — `bag` was typed from `this`
  this.use(SizeHook, (bag) => ({ width: bag.props.width }));

  // now — annotate the owner
  this.use(SizeHook, (bag: Panel) => ({ width: bag.props.width }));
  ```

  `never` rather than `any` on purpose: an unannotated parameter fails with `Property 'props' does not exist on type 'never'` instead of silently widening to `any`. Typing it as `this` is not an option — resolving an overload would need the type of the class whose field is being declared, which is a TS7022 circularity on every call site. Every call site in this repo and in the docs already annotates.

- 124d210: RMD023, `static StableProps`, and `each` that takes nothing.

  **RMD023 — components built from an array with no keys.** The check RMD020 cannot make: a
  mapper is handed to `Array.prototype.map` and never stored anywhere a comparison can reach,
  and its output is a run of freshly built vnodes, which is what all JSX looks like. Structure
  is the only evidence — JSX passes children as separate arguments, so a nested array among
  them was built by an expression. `normalizeChildren` brands its own arrays (DEV only) so
  `{this.props.children}` is not mistaken for a mapped one.

  Narrowed twice, and the history is the reason to trust it. Reporting every raw array broke
  10 of core's own tests, all exercising child groups on purpose — a mapped array is a
  supported shape here, with its own key space. What ships reports only what is genuinely
  unhandled: two or more UNKEYED COMPONENT rows, whose identity is their position, so
  inserting or removing anywhere but the end moves state and DOM to the wrong item. Plain
  markup is not reported (the diff patches it and the result is correct), keyed children are
  not reported, forwarded children are not reported.

  **`static StableProps` — the hook declares which props are values, so the call site does
  not.** A query key is a value: `["user", 7]` built again is the same question, and that is
  the hook's knowledge rather than something every component using it should encode. `Query`
  declares `key`, `Mutation` declares `invalidates`, and the framework hands back one identity
  for as long as the contents are equal:

  ```tsx
  key: ["user", self.props.id]; // a plain literal; nothing to wrap
  ```

  `stable()` stays for the other direction — a hook you do not own that declared nothing. A
  declaration cannot cover a function prop: two closures with the same body are not equal by
  any comparison that is safe to make, so a listed function is left alone and still reported.

  **`each` accepts `null` and `undefined`** and renders nothing for them. The list engine
  already handled it; only the type forbade it. This removes the `?? []` that every "data has
  not arrived yet" list was writing — a fresh empty array on every render, which cost the list
  its item scopes and was itself reported by RMD020.

  **Documentation: what a hook author cannot assume.** A reusable hook is written against what
  it might be handed, not against a well-behaved caller — it does not know when it will be
  called, whether a value is the same object as last time, what the value is, or whether the
  diagnostics are even running. So: compare by value what is a value, and be idempotent about
  the rest. `Query.onKeyChanged` is the worked example, comparing the key itself even though
  the framework already did.

- 0cab315: `stable()`, and RMD022 — the strict render now covers a hook's props callback.

  `render()` and a props callback are the same kind of thing: code the framework calls
  unconditionally on every render, whose result is compared against the last one. `render()`
  had both a check and the tools to satisfy it (`@memoizedHandler`, `list()`); a props bag
  had neither. Now it has both.

  **`stable(value)`** keeps an array or object in a bag at one identity for as long as its
  contents are equal — the counterpart of `list()` for a props bag:

  ```tsx
  private user = this.use(Query, (self: UserCard) => ({
    key: stable(["user", self.props.id]),   // the same array until `id` moves
    fetch: self.load,                        // a bound method is already stable
  }));
  ```

  It runs in production too: this is behaviour, not a diagnostic. Contents are compared by
  value to a bounded depth, so a nested literal gets a fresh reference rather than a wrong
  one.

  **RMD022** calls the callback twice in the same tick and compares the two bags, reporting
  a rebuilt array (`stable()`), a rebuilt closure (a bound method, or `@memoizedHandler`),
  or two different contents (the callback is not a function of state). Part of the strict
  render, so `configureDev({ strictRender: false })` turns it off with RMD020.

  **Why it matters more than "an extra allocation".** Every prop is a signal, and a signal
  compares by reference, so a rebuilt array is a _changed_ prop. Measured across three
  renders of the owner: a hook `@compute` reading a rebuilt array runs 3 times where one
  reading a scalar prop runs once; a `@watchProp` on a rebuilt array fires on every update
  render; a child component handed a rebuilt function re-renders 3/3.

  **Why twice on every render, not once at the start.** A callback with an `if` in it only
  ever proves the branch it took, so a first-render-only check passes the case that breaks
  later — while reporting the legitimate branch difference as a fault.

  Also in this release: a production build test. `apps/docs` now builds a fixture
  application and asserts that no diagnostic code, no diagnostic message and no devtools
  reach the output, with a development build as the control so the test cannot pass
  vacuously. It immediately found a real leak: a DEV gate written as `if (!__DEV__) return …`
  with the checks after it, rather than `if (__DEV__) { … }`, left `checkPropsStability`
  reachable and pulled `diagnose` — and every diagnostic's title and fix text, all 21 of
  them — into the production bundle.

- 8cedc9b: New DEV diagnostic: `RMD021` — randomness generated during a `render()`, a `@compute`, a `@memoizedHandler` builder, or a hook's props callback.

  `Math.random`, `crypto.randomUUID` and `crypto.getRandomValues` are patched in development (the trick `timerGuard` already uses for timers) and report when called while one of the four pure phases is running. Four messages, because the same call fails differently in each place:

  - **render** — the output depends on when it ran, so a server render and its hydration disagree (RMD007).
  - **`@compute`** — quieter and worse: the answer is cached, so the value is frozen until a dependency the compute actually READ changes, which may be never.
  - **memoised handler** — the value is cached _with_ the handler, so every call uses the same one. The builder runs during a render, so without its own phase marker the report would have named the render and pointed at the wrong fix.
  - **a hook's props callback** — the sharpest of the four: the callback runs on every render, so the prop holds a different value each time. As a query key that is a new cache entry per render and a fetch that never settles. This is also why the callback does NOT run twice in a strict render — watching the call catches the same mistake, and a callback may do more than build an object.

  **Why it exists next to RMD020.** The double render finds non-determinism only when the two calls differ. Measured over 200,000 tries: `Math.random()` and `performance.now()` differ every time, `new Date()` differs every time (a fresh object), and **`Date.now()` differs in 0.006%** — the two renders are microseconds apart, inside one millisecond. So the double render is blind to a millisecond clock.

  **Why the clock is still not patched.** That was the first version and it was wrong: a patched global catches the _platform's_ calls too. An `Event` constructor stamps `timeStamp`, which under jsdom is a JS-visible `Date.now()` — so raising any diagnostic during a render tripped it, and three of core's own tests began failing with RMD021 instead of the code they asserted. Under jsdom is where every app runs its own tests, which makes that disqualifying rather than fixable. Randomness has no such problem: nothing in the platform generates it behind your back.

  The docs now carry the full inventory of non-deterministic reads and which check covers each — including the one gap neither covers: `Date.now()` in a client-only app, rendered into the output.

- c166868: **BREAKING: `@effect` is removed.** Every case it served has a decorator that says what it
  is for, and having one that said nothing was what made circular updates easy to write.

  Where each case went:

  | what the effect was doing        | what to use                                                                                                                     |
  | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
  | subscribing to something outside | `createSubscriptionDecorator` — same "return the cleanup" contract, and it re-connects when a signal its `connect` READ changes |
  | reading the DOM after the commit | `@updated`                                                                                                                      |
  | reacting to a prop               | `@watchProp`                                                                                                                    |
  | deriving a value                 | `@compute`                                                                                                                      |

  The machinery is untouched. `attachEffect` still runs the queue after the DOM work, and
  `createSubscriptionDecorator`, `@onElement`, `@onWindow`, `@onDocument`, `@interval`,
  `@timeout` and `@deferHydration` are all still built on it. What went is the door that
  handed the raw body through with no contract about what it returned.

  **Why, in one sentence:** an effect was whichever of those four it happened to be, decided
  by what its body read — so two of them writing what the other read re-triggered each other,
  and nothing could name the cause. RMD009 caught the loop but could only say "this component
  rebuilt 50 times", and its fix text had to guess. Naming what a piece of code is for is what
  lets the framework say something useful when it goes wrong, and makes the ordering knowable
  instead of emergent.

  `Head` was the framework's own last user, and the migration made it smaller: as a
  `@watchProp` whose selector returns a serialized form, the comparison is by value for free
  and the `appliedSnapshot` guard field is gone. That guard only existed because effects run
  child→parent while `@create` runs parent→child, so an effect handed a nested route's title
  back to its layout on the first commit. A `@watchProp` runs in the same order as `@create`
  and does not fire on mount, so both halves agree and the deeper `Head` wins.

  Also in this release, from the same pass:

  - The docs page `/concepts/effects` is now `/concepts/subscriptions`, and it states what
    each of the four replacements is for and when it runs.
  - RMD009's, RMD008's, RMD011's and RMD019's fix texts named `@effect` as the usual cause;
    they now name `@updated` and subscriptions, with the line that matters spelled out — a
    post-render write must CONVERGE, because assigning the same value is not a change and
    schedules nothing.
  - Tests of the shared machinery kept their coverage through a harness in `src/test/`
    (`effectLike`), which is `createSubscriptionDecorator` with the decorated method as the
    whole connect. It lives in `test/` on purpose: it is a way of saying "an effect, unnamed",
    which is the thing that was removed.

- 894b094: New DEV diagnostic: `RMD020` — development builds render every component **twice** and report what came out different.

  With no state change between the two calls, anything that differs was built by the render itself, or does not come from state at all. Three things get named, each with its own fix:

  - **a function built in place** — the source is identical, only the identity is fresh. An event handler whose identity changed is removed and re-added on the element every render; a function passed to a child re-renders that child. `@memoizedHandler` returns the same function for the same arguments, so it reads as stable.
  - **an object or array built in place**, with equal contents — a child re-renders, a `@compute` recomputes, and if it is a list's items every row loses its identity and the whole list is rebuilt.
  - **a value that is not a function of state** — `Math.random()`, `performance.now()`, `new Date()`. Only the part of that class that varies WITHIN a tick: the two renders are microseconds apart, so a millisecond clock reads the same both times (measured: two consecutive `Date.now()` calls differ in 0.006% of 200,000 tries). RMD007 catches those instead, because a server render and its hydration are milliseconds apart. Neither check covers the class alone.

  **Why twice rather than comparing against the previous render:** that comparison cannot tell "created in place" from "genuinely changed". Two calls in one tick can, with no false positives.

  **Why every render:** measured, `render()` is 3-4% of a commit — and 0.04% for a table of 500 rows, because `list()` is lazy, so a second render rebuilds the descriptor and not the items. Checking only the first render would miss every branch not taken then, which is where handlers live.

  **Not** a hook's props callback, and that is a decision the audit made rather than an omission: the callback exists in order to re-run per owner render, so the bag and the closures inside it are fresh by design (a fetcher closing over a prop cannot be stable). Reporting them was a warning per hook with nothing to do about it. A vnode passed as a prop is walked rather than reported, for the same reason at a smaller scale — JSX is a fresh object every render, and what still counts is an inline handler inside it.

  **One thing to expect:** a `render()` with a side effect performs it twice in development. RMD001 already makes a state write there an error, so "render is pure" is the rule either way — but a `console.log` in a render really will appear twice. Production strips the check entirely (verified: no `RMD020` and no symbol from the module survives in the prod bundle).

- 9e87633: `@watchProp`'s selector is typed from the class it is on — no annotation, no type argument.

  ```tsx
  @watchProp((props) => props.userId)   // props is UserProps
  reload(next: string, previous: string) {}
  ```

  `props.usreId` is now a compile error where it used to be `unknown` (so anything compiled).
  The mechanism is the same one `@Host` and `@StableProps` use: `This` appears only in the
  decorator CONTEXT and inside a conditional type (`PropsOfInstance<This>`), and a conditional
  is not an inference site — so TypeScript defers it to the application, where the decorated
  class supplies it. The selector's return type still fixes the value type, so the method is
  checked as `(V, V) => void`.

  **Hooks needed one addition to make this work.** `Hook.props` is `protected`, so a
  conditional type reads `never` off it, where `BaseComponent.props` is public. `Hook` now
  carries its props type in a phantom — `declare readonly [PROPS_TYPE]?: R`, symbol-keyed and
  optional, so it emits nothing, collides with nothing, and appears in no autocomplete.

  **What still needs annotating, and why.** The decorated METHOD's parameters. A decorator
  does not contextually type the signature it decorates, so unannotated parameters are an
  implicit `any` (TS7006) — measured, not assumed. That is a TypeScript limitation.

  Annotated selectors keep working when the annotation matches. Three inside `@ramonda/query`
  did not: `(props: QueryProps<unknown>)` on a `Query<TData, K>` is not the same type, and the
  compiler now says so. They are unannotated, which is what the change is for.

- 894b094: New lifecycle decorator: `@updated` — runs after the DOM of an **update** is committed.

  `@mount` runs once, with the element in the document. `@updated` runs after every commit after that, and it is the only way an app can read or correct its own committed DOM: updates are batched through a microtask, so the DOM is not touched yet when the handler that changed state returns — and not every update has a write site of yours to stand in (a parent re-renders you with new props, a context value changes, a hook you use writes its state).

  ```tsx
  class Row extends Component<{ selected: boolean }> {
    @updated
    keepVisible() {
      if (!this.props.selected || this.scrolled) return;
      this.scrolled = true;
      this.element.scrollIntoView({ block: "nearest" });
    }
  }
  ```

  **No dependencies, no previous values, no cleanup**, and each is deliberate:

  - Nothing is tracked while it runs, so there is no dependency list to get wrong — and no repeat of the trap that makes an effect the wrong tool for this: an effect re-runs when a dependency _changes_, and a dependency that is an array or object rebuilt by a props callback changes on every render.
  - The `if` that would want previous props is reconstructing what changed, which is `@watchProp`'s job. The `if` that belongs here asks "is the DOM already how I want it?" — and only the author can answer that. So: **reacting to a value → `@watchProp`; touching the DOM afterwards → `@updated`**.
  - Cleanup is `@destroy`'s; a subscription is `createSubscriptionDecorator`'s.

  It fires unconditionally, so guard an expensive body — a `getBoundingClientRect` forces a layout, which costs orders of magnitude more than the dispatch (~270ns).

  Runs **children before parents**, after this commit's mounts and effects, and never on the server. Writing state in it schedules another render (the measure-store-render pattern); a runaway is reported as RMD009.

  A component that does not declare it pays a length check, not an entry in the flush.

- 465918f: `@watchProp` on a **hook** now watches the hook's own props, not the owner component's.

  A hook shares its owner's runtime, so `runtime.watchProps` holds the component's entries and every hook's in one list — and running that list handed all of them the COMPONENT's `rawProps`. A hook watching its own prop therefore never fired, while its selector was quietly reading a bag it has no relationship to:

  ```ts
  class Loader extends Hook<{ target: string }> {
    @watchProp((p: { target: string }) => p.target)
    reload(next: string) { … }   // never ran — the selector was given the owner's props
  }
  ```

  Each entry now records the instance it was declared on, and the runtime reads that instance's props (`WatchPropEntry.owner`). Components are unaffected: they were always given their own props, and still are.

  **Breaking only for code that relied on the old reading** — a hook using `@watchProp` to observe the _owner's_ props. Pass the value into the hook instead, which is what the props callback is for:

  ```ts
  loader = this.use(Loader, (self: Panel) => ({ target: self.props.userId }));
  ```

### Patch Changes

- 2806fb1: A subscription decorator applied to the wrong kind of class now says so.

  `createSubscriptionDecorator`'s owner requirement was expressed as `This extends Owner` on
  the returned decorator. It worked — a class that did not satisfy the `connect`'s owner type
  was rejected — but the message was about `access.has` being contravariant and about the
  decorated method being missing from the owner type. True, and unreadable.

  It is a brand now, the same shape `@StableProps` uses for its prop names, so the failure
  lands on a named property and the message carries the owner type that was required.

  Also documented, because nothing said it: annotating `connect`'s `owner` parameter is how a
  decorator demands something of the class it goes on, and it gets the concrete instance —
  `(owner: Component<{ id: string }>, …) => store.subscribe(handler, owner.props.id)`. Leaving
  it unannotated makes the decorator work on any component or hook, which is what the built-in
  ones do. Three tests now lock all of it, including the one thing that does NOT work: the
  decorated method's parameters still need annotating (TS7006), for the same TypeScript reason
  `@watchProp`'s do.

## 0.0.2

### Patch Changes

- 7b530bb: Fix an unhandled rejection in dev mode when `@ramonda/devtools` isn't installed.

  In development, core dynamically imports the optional `@ramonda/devtools` for its
  side effect (registering the in-page inspector). That import had no `.catch`, so in a
  project that never installed devtools — e.g. a scaffold created with the testing add-on
  but not the devtools one — running a test surfaced a stray
  `Cannot find package '@ramonda/devtools'` unhandled rejection, even though the test
  itself passed. The import is now guarded to the browser (`typeof document`) and its
  absence is swallowed: no devtools just means no inspector, not an error.

- 72fb118: **Breaking:** unify hook input on `props`, and rename `@shouldUpdateProps`.

  A hook's input is now called **props**, the same word (and idea) as a component's —
  read from `this.props`, not `this.options`. One concept, one name. The `HookOptions`
  type is now `HookProps`, and a write to a hook's props throws `RMD015` worded around
  `props`.

  ```ts
  // before
  class Counter extends Hook<CounterOptions> {
    @state n = this.options.start;
  }
  // after
  class Counter extends Hook<CounterProps> {
    @state n = this.props.start;
  }
  ```

  The `@shouldUpdateProps` decorator is now **`@shouldUpdateOnPropsChange`**. The old
  name read like "should the props update" — but props always update; the decorator
  decides whether new props from the parent are _taken up at all_ (their signals update
  and a render is scheduled). Returning `false` drops the whole update, props included —
  this is now documented accurately. It runs only on prop changes, never on the
  component's own `@state` writes. It is **components only** and now throws if placed on
  a hook (a hook has no parent-driven prop update to gate), instead of silently doing
  nothing.

- 7b530bb: `@create`, `@mount` and `@destroy` now receive the render side as an argument.

  The decorated method is called with `env: RenderEnv` (`"client" | "server"`), read from the
  component's own runtime — so a shared lifecycle method can branch on where it is running (for
  example, skip a browser-only fetch during the server render) without a `typeof window` check.
  That check is unreliable anyway: server rendering runs under a DOM shim where `window` and
  `document` exist, so it can't tell the two sides apart. The argument is correct even inside an
  `async` method after an `await`, and even across concurrent server renders.

  Declaring the parameter is optional — existing zero-argument lifecycle methods are unaffected.
  The `RenderEnv` type is now exported.

  Note: this gates where code _runs_, not whether it _ships_. A `server` method's body is still
  bundled to the client, so it is not a place for secrets — keep those behind an API.

- 30979b6: Add **RMD019**, a dev-mode diagnostic for non-serializable `@state`.

  `@state` is carried to the client in the hydration blob as JSON, so it can only hold
  JSON-serializable data. Assigning a **function**, **symbol**, or **bigint** to a
  `@state` field — at its initializer or a later write — is now reported (dev only), at
  the moment it happens, on the client too. Previously this was only noticed by the SSR
  serializer, and only during a server render.

  The check is scoped to `@state` (not props, which legitimately hold callback
  functions) and is O(1), so it stays off the hot path's back. Deeper cases (a `Map`, a
  circular object) remain the SSR serializer's job.

- 7b530bb: Server renders can now redirect the request instead of producing a page.

  New exports `ServerRedirect` and `captureServerRedirect`. When code in the tree
  asks — during a server render — to navigate elsewhere (a route guard sending an
  unauthenticated visitor to `/login`, say), `renderToString` throws `ServerRedirect`
  rather than returning markup. A server boundary catches it and answers with a
  redirect (a 302 and a `Location`), so the browser navigates to the right URL and
  requests the correct page — instead of being handed markup for the wrong one, which
  would then snap back the instant the client read `window.location`.

  `captureServerRedirect()` is the low-level primitive the router builds on: called
  synchronously while the tree is being built, it returns a function that records a
  redirect for _this_ render (or `undefined` on the client). First writer wins.
  `renderPage` also clears the document head on the redirect path so a long-lived
  server process cannot leak one request's head tags into the next.
