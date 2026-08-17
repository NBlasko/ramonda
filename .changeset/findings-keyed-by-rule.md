---
"@ramonda/check": minor
---

**Breaking:** `AnalyzeResult`'s per-rule lists are now one `findings` object keyed by rule name.

`result.arrowFields` becomes `result.findings["arrow-fields"]`, and the same for `browserUrlReads`,
`domWrites`, `duplicateDecorators`, `unwatchedFields` and `dynamicImportPaths`. Nothing else on the
result moved: `issues`, `counts`, `graph`, `unresolved`, `annotated` and the graph's own checks are
where they were.

Nothing is lost but the spelling. Each list is still typed as that rule's own issue — `findings` is
derived from the rule registry, so the key and the element type are read off the rule rather than
declared a second time.

The reason is what a rule used to cost. Each one meant a line in the published interface, a line in
the CLI's destructure, a report block written by hand, and a clause in the sentence that says
everything is fine — and that last one is the sharp edge: a rule added without its clause would have
printed "everything is fine" directly above its own report. That condition is derived now, so it
cannot be forgotten.

How a rule says what it found moved onto the rule as well, so `ramonda-check`'s output for a given
finding is unchanged. Two lines of wording did change, both deliberately: the all-clear sentence no
longer lists the rules by name (it grew with every one), and the duplicate-decorator advice no
longer carries a `[ramonda-check]` prefix that no other rule's advice had.
