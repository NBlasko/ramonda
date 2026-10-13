---
"create-ramonda": patch
---

The scaffolder's `@ramonda/*` pins match the release that ships beside it

`@ramonda/core` and `@ramonda/check` are released in this batch, and the scaffolder writes their
version ranges into a new project from `__RAMONDA_RANGES__` — a constant `tsup.config.ts` injects at
BUILD time from the workspace. `changeset publish` publishes only what was bumped, so without this
the published CLI keeps pinning the release before this one, and `npm create ramonda` hands every
new project a range that no longer matches what is on npm.

Nothing in the scaffolder's own source changes; the bump is what carries the new pins to npm.
