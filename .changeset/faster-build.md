---
"@ramonda/css": patch
---

**A build and the editor do less work per file.** A property's keyword list was split into a set on
every value it checked, a block head's pattern was compiled on every head, and every file importing
a module read and parsed it again. Each is made once now. Measured on 1000 files of ten blocks
(`pnpm bench:css`): a build went from 6.1 to 4.2 ms per file, the editor's check from 3.3 to 2.0 ms.
Nothing a block compiles to, or reports, changes.
