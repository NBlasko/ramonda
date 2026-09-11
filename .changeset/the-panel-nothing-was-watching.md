---
"@ramonda/core": patch
---

The devtools panel the entry wires up is under test, and a comment stops naming a file that does not exist

`index.ts` does three things for the panel at module load, inside `if (__DEV__)`: it appends
`<ramonda-devtools>` once the element is defined, it turns Alt+D into a `ramonda:toggle-devtools`
event, and it attempts an optional import of `@ramonda/devtools`. Nothing tested any of them. The
file's own comment records what that cost once — the append and the shortcut used to live inside that
import's `.then()`, so an app that imported the panel itself got the logs and no badge.

Four tests now hold it: exactly one panel and in the body, Alt+D and only Alt+D, no second panel when
the entry is loaded again, and the shape of the block itself.

The last one reads the source, and that is not laziness. Measured: `vi.doMock("@ramonda/devtools")`
never runs, because the specifier is held in a variable — deliberately, since a literal one breaks
`vite build` for every app that has not installed the panel. `@ramonda/devtools` is also a
devDependency of core, so in a test run that import RESOLVES and the panel appears whether or not the
mount depends on it. Planting the historical bug back proves the point exactly: with the mount and
the shortcut moved into the import's callback, the three runtime tests still pass and only the shape
test fails.

The comment that pointed at `NodeEnvironment.test.ts` for the no-DOM guarantee now points at what
actually holds it: `scripts/check-bare-import.mjs`, which imports every published entry in its own
Node process with no DOM, and lists `@ramonda/devtools` as browser-only while `@ramonda/core` is not.
That file has never existed anywhere in the repository.
