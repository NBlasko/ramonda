---
"@ramonda/core": patch
---

An element with one child keeps that child as its record

The record of what the diff placed in an element holds a lone child on its own and builds an array
only for two or more. Most elements on a page hold one child, a cell's text or a link's label, so the
diff builds one array less for each of them. Measured beside the previous build on
js-framework-benchmark, two runs in opposite order, median script time: creating 10 000 rows went from
406 to 380 ms and from 433 to 402 ms, and selecting a row from 109 to 102 ms and from 117 to 108 ms.
Appending 1 000 rows went from 42 to 50 ms and from 46 to 51 ms, with a spread of ±6 ms.
