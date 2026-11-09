---
"@ramonda/core": patch
---

A list handed the same array again takes its rows by position

When a list's array is the same one as last render and a row of it was invalidated — every row of a
list reading the one value that moved, as selecting a row does — each row's id and scope is where the
last render left it. The list now takes them by position, instead of rebuilding the maps that find them
by item and by id. Measured on js-framework-benchmark with the row compiled into a template, median
script time for selecting a row went from 27.9 to 22.0 ms; creating and updating rows are unchanged.
