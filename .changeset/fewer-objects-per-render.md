---
"@ramonda/core": patch
---

A render builds fewer throwaway objects

A list pass no longer builds a map of occurrences and an array per row to say that each item appears
once — an item the list holds once keeps one id. The JSX runtime hands on the props of an element with
no children as its attributes instead of copying them, and an element built with no children shares
one empty record. Measured beside the previous build on js-framework-benchmark: creating 10 000 rows
ran 451 → 423 ms of script; the rest unchanged.
