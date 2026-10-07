---
"@ramonda/css": patch
---

**A build and the editor do less work per file.** A property's keyword list was split into a set on
every value it checked, a block head's pattern was compiled on every head, and every file importing
a module read and parsed it again. Each is made once now, and so is splitting a shorthand, folding a
value's keywords and naming a property in a class — once per value, not once per time it is
written. Measured on 1000 files of ten blocks (`pnpm bench:css`): a build went from 6.1 to 2.3 ms per
file, the editor's check from 3.3 to 1.2 ms.

**A long block no longer takes the square of its length.** `override-out-of-order` compared every
declaration with every one before it: a block of 4000 custom properties — a generated theme — took
3.2 s to build, and 16 000 took 57 s. It compares only the declarations that can fight now, and 8000
take 0.14 s. Nothing a block compiles to, or reports, changes.
