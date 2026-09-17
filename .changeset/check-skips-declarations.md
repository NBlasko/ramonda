---
"@ramonda/check": patch
---

The overlay host no longer reads every declaration file looking for a style block.

It is handed every file a TypeScript program touches, and asked whether each one holds a block that
needs a virtual copy. Measured on this repository's documentation app: 724 files and 9.4 MB, of
which 171 are declaration files worth 3.8 MB — 40% of everything read. Twelve files in the whole
program contain the syntax at all.

A declaration file cannot hold a block: it declares types, and TypeScript allows no initialiser in
an ambient context. The question is now `fileMayHoldABlock`, which is the one every other consumer
of the compiler asks — the editor plugin, the CLI check and both bundler adapters — so none of them
can disagree with another about which files are looked at.
