---
"@ramonda/check": minor
---

The analyzer reads a project whose source contains `@( … )` style blocks

A style block is written in real CSS beside the markup and compiled before the build. Its syntax is
not TypeScript, and this reads the author's source — so the compiler's parser gave up at the block
and error-recovered, and **every rule that walks the tree below that point simply found less.**

That is the whole reason this matters: the run looked exactly as healthy as a clean one. Measured
with this package's own CLI, on one component differing only in where the block sits among the
attributes:

```
block LAST  :  half-built-keyboard-path  positive-tabindex  unnamed-image
block FIRST :  unnamed-image
```

Two accessibility faults gone, exit code 1 either way. A report that is trusted and quietly
incomplete is worse than no report. The certificate landed on the same requirement: `complete` fails
on a reference the parser threw away, so a package whose source uses a style block could not honestly
certify.

The program is now built over a host that serves each such file's compiled reading, under the file's
own name — so nothing about module resolution moves. The reading is deliberately forgiving: a
checker's job is to report what it can see, and a block half-written in somebody's editor is not a
reason to stop analysing the file it is in. Whether the block itself is well formed is `ramonda-css`'s
answer, and that is the one that fails a build.

**Nothing changes for a project that does not use the syntax**, and nothing is added to what this
package installs: the reader is bundled the way `@ramonda/dom-facts` already is, so `@ramonda/check`
still publishes with no runtime dependency at all — which is the property that lets it run first in a
build.
