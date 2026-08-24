# @ramonda/testing-library

## 0.2.3

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

## 0.2.2

### Patch Changes

- 48ec521: A value the caller hands in is a slot, whether it arrived as a prop or as a parameter.

  `<this.props.view />` has never been a defect: nothing in that class can say what it mounts, and
  nothing was meant to. `__h(type, …)` inside a JSX runtime is the same promise written differently,
  and reporting one and not the other made the framework apologise for being a framework — thirteen
  escape hatches across this repository against a plan whose own test is that more than a handful
  means the rule is formulated wrongly.

  A mount whose named value traces to a parameter is now an edge that says what it waits on:

  ```json
  {
    "from": "@ramonda/core/src/jsx-runtime.ts#jsx",
    "kind": "unresolved",
    "via": "parameter",
    "slot": "type",
    "at": "@ramonda/core/src/jsx-runtime.ts:55:7"
  }
  ```

  `parameter` is a new `via` value, which is what the format's split between `kind` and `via` exists
  for: a reader that switches on `kind` is unaffected. It is a second value rather than a flag on
  `slot` because a prop edge is FILLED from what a JSX call site binds and a parameter must never be
  — a package whose `Frame.show(view)` mounts its own argument, spliced into an app writing
  `<Frame view={Foo} />`, would otherwise have `Foo` judged under `Frame`.

  A path works at any depth (`options.wrapper`), a cast is seen through, and `this.use(hook)` makes
  the same promise about a hook. **Thirteen annotations become five**, measured by deleting all
  thirteen and running every project: core keeps none, testing-library two, the documentation site
  one, the playground its two deliberate failed-load demos.

  **What stays a hole**, because reading either means running something: what a CALL returns
  (`bootstrap(wrap(ui), container)`) and whatever a LOCAL BINDING was last assigned
  (`const tag = …; __h(tag, …)`).

  **The cost, plainly.** A mount whose value came from a parameter is no longer an error anywhere, an
  app's own helper included. It is a marked blank rather than a reported one. What it does not buy is
  coverage: nothing fills these — the compiler calls `jsx`, and a wrapper handed through a call
  argument is not a JSX binding.

  **A latent false positive fell out of it, and it is the more useful half.** Judging and walking
  shared one early return, so everything below an OPAQUE component was unreached — and the
  dead-declaration rule read that as "nothing mounts this" with the tag one line above it in the same
  file. The two questions are now separate: what a component provides is unknowable below an opaque
  one, and what it mounts is written in its body and perfectly visible.

  `@ramonda/core` and `@ramonda/testing-library` lose the annotations they no longer need; nothing
  else changes in either.

  **Four faults a review found on this branch, all of them in the new code:**

  - `this.use(hook)` written WITHOUT a cast resolved to the parameter's own symbol and so missed the
    branch that marks a component opaque — silenced but transparent, which is the worst of both: a
    consumer below it reported against a component that may well have been providing for it, and no
    hole left to point at the cause. Only the cast spelling was covered, so the tests passed. Opacity
    is keyed on the value tracing to a parameter now, and **not** on merely reaching that branch:
    widening it is the opposite fault, and `this.use(Form<typeof schema>)` arrives there too.
  - A `ramonda-check-ignore` already written on a site that becomes a slot went silently dead — out
    of the list printed on every run, which exists so the number cannot creep up unread, and an EMPTY
    directive was accepted there while being refused everywhere else. It is read before the edge is
    emitted now.
  - A root's reason was computed from a JSX element that is absent when the argument is not JSX, so
    the edge said it waits on `vnode` while its own `why` said there was nothing to wait on.
  - The format's own documentation for `slot` still described a prop. It says what it now carries,
    and that neither kind belongs in a node's `slots`: the `from` of a parameter edge can be a root
    or a free function, which have no props at all.

  **And two more from a second review, over the fixes themselves.** A spliced fragment filled a
  parameter from a colliding prop name — the fault above, found before it could bite and pinned by a
  vendor package that mounts a method argument. And the exemption for a PROP never read its own
  directive either, so the two symptoms fixed above still held there: both call one reader now.

## 0.2.1

### Patch Changes

- 1384a5f: Two more ways a component is mounted, and the documentation site is finally visible.

  **A function that mounts through the factory and writes no tag at all** is a helper like any other.
  It was recognised by looking for JSX tags, so a function that walks a content tree and calls `__h`
  for every node was not one — its body was never walked, and everything it mounts was unreachable
  while it sat in plain sight.

  **A helper handed OVER rather than called** — `tree.map(toVNode)` — is reached too. Whoever it is
  given to will run it, so what it mounts is reachable from there.

  Measured on this repository's documentation site, which renders its entire content tree that way:
  the walk reached **10 of 153 nodes** when this work started, 90 after the factory and the looped
  route table, and **142 of 157** now. The only thing of its own it does not reach is the SSR entry,
  which nothing calls because the server calls it.

  Four more sites carry an escape hatch, and they are all one shape — a function that mounts whatever
  it is handed. Three are `@ramonda/core`'s JSX runtime, which is that shape by definition, and one is
  `@ramonda/testing-library`'s wrapper. Two more name an element from a parsed content tree.

## 0.2.0

### Minor Changes

- 05c28dc: A component this cannot follow is an error.

  The walk goes quiet below a name it cannot resolve, so everything under it is unjudged and the build
  passes over a page that may be broken. That is the one thing this package cannot afford, because its
  whole value is that a report is a real broken path rather than a maybe — and that only holds while
  the map has no unmarked blanks.

  The constraint is not this tool's to impose. A bundler can only split what it can see statically, so
  whatever this cannot resolve could not have been code-split either: the shape was already trouble
  for another reason.

  **The escape hatch is a record.** When the source is right and this is the one that cannot see it,
  write the reason on the line:

  ```tsx
  // ramonda-check-ignore the caller hands us the tree to mount, which is what this helper is for
  bootstrap(wrap(ui), container);
  ```

  Line-scoped, never file-scoped — a file-scoped suppression blinds a whole file with one line, which
  is exactly what somebody in a hurry reaches for. The reason is mandatory: a directive with nothing
  after it is refused. And every annotated site is listed on every run, whether or not anything
  failed, so the number cannot creep up unread.

  A tag naming a prop is not one of these. `<this.props.view />` is unresolvable from the class alone
  by design, and the walk fills it from what the caller binds.

  Messages carry the fix as CODE rather than as advice, because most of what this reports on will be
  written by an agent, and an agent acts on a patch far more reliably than on a sentence.

  **Measured across this repository: three sites need the hatch**, all in `@ramonda/testing-library`
  and all the same shape — a helper that mounts whatever the caller hands it, which is its whole job.
  Those three carry their reason now. The two in `apps/playground-core` are demonstrations of a failed
  load, which is what they are for.

## 0.1.1

### Patch Changes

- cb023eb: Follow core's lifecycle decorator rename

  Both packages use the lifecycle decorators in their own source — `@created({ env: "client" })` in the
  router's navigation counter, `@mounted` and `@destroyed` across the testing library's harness — so both
  had to be republished with the new names.

  **A published copy of either will not work with the renamed core.** They declare core as a peer with a
  range wide enough to admit it (`>=0.1.0 <1.0.0`), and that range cannot express "only the versions where
  these names exist", so npm will happily install the pair and the import fails at load with
  `create is not exported`. Upgrade the two alongside core rather than one at a time.

## 0.1.0

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

## 0.0.4

### Patch Changes

- b21ce8f: `await act(async () => …)` is typed as a promise again.

  Reported as an editor complaint on `await settle()` — _"'await' has no effect on the type of this
  expression"_ — and it was right. `act`'s sync overload was declared first, and a `() => void` parameter
  accepts a function returning **anything** (that is what `void` means in a return position), so
  `act(async () => {})` matched it and typed as `void`.

  Nothing misbehaved at runtime: the implementation looks at what came back rather than at what was
  declared, and every existing test passed both before and after. The cost was a false hint on every
  `await act(…)` in every repo using it, which is the kind of noise that teaches people to ignore hints.

  The promise overload comes first now, and there is a type assertion holding it — enforced by
  `check-types` rather than by the test run, since `expectTypeOf` compiles to nothing. Verified by putting
  the old order back: `vitest run` still reports every test passing, and `tsc --noEmit` fails.

## 0.0.3

### Patch Changes

- bc71a1c: The `@ramonda/core` peer range spans the whole pre-1.0 line: `>=0.0.2 <1.0.0`.

  It was `workspace:^`, which publishes as `^0.0.2` — and a caret on `0.0.x` allows only
  `0.0.x`. So the first minor of core put this package's declared peer range out of date, and
  Changesets did the correct thing with that: a peer dependency going out of range is a
  **major** for the dependent. A test helper going to 1.0.0 while the framework it tests is at
  0.1.0 says something untrue about both.

  The range now states what is actually meant — this works with any pre-1.0 core — so a core
  minor no longer takes it out of range. `.changeset/config.json` gained
  `onlyUpdatePeerDependentsWhenOutOfRange` alongside it, which is what makes Changesets
  consult the range instead of majoring every peer dependent on principle.

  Kept as a peer dependency rather than moved to `dependencies`, which would also have
  silenced the bump: a test helper that brings its own copy of the framework is how a
  component ends up extending a different `Component` than the one rendering it. The docs
  app's vitest config carries a measurement of exactly that failure.

## 0.0.2

### Patch Changes

- 72fb118: **Breaking:** `renderHook`'s `initialOptions` is now `initialProps`, following the
  core rename of a hook's input from "options" to "props".

  ```ts
  // before
  renderHook(Counter, { initialOptions: { start: 2 } });
  // after
  renderHook(Counter, { initialProps: { start: 2 } });
  ```

- Updated dependencies [7b530bb]
- Updated dependencies [72fb118]
- Updated dependencies [7b530bb]
- Updated dependencies [30979b6]
- Updated dependencies [7b530bb]
  - @ramonda/core@0.0.2
