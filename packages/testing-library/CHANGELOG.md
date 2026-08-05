# @ramonda/testing-library

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
