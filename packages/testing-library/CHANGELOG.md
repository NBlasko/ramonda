# @ramonda/testing-library

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
