# @ramonda/testing-library

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
