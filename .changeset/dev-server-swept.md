---
"@ramonda/css": patch
---

The dev server is measured across files, across long editing sessions, and across a file gaining its
first block.

No behaviour changed for these — the sheet already withdraws what a file claimed before re-claiming
it, so two files sharing an atom stay right when one stops naming it, and fifty saves leave a file
serving its own two rules. Nothing asserted any of it: every dev-server test saved one file and
asked about that file.
