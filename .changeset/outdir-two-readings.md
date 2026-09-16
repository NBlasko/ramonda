---
"@ramonda/css": patch
---

An `outDir` the editor cannot read is refused instead of quietly breaking `$`.

The folder is read twice: codegen transpiles the config and gets the real value, while the
per-file lookups read the key out of the config's text, because they run in an editor on every
keystroke's worth of work. When the two disagree — the key computed, or merely mentioned in a
comment earlier in the file — the generated files land in one folder and everything that reads them
looks in another. What the author was shown was `Property 'size' does not exist on type "Declare
your variables in ramonda.css.ts, then run ramonda-css …"`: advice they had just followed.

Codegen now compares the two readings and refuses, naming both folders, before anything is written.
