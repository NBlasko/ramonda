# @ramonda/testing-library

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
