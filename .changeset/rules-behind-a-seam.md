---
"@ramonda/check": patch
---

Internal: the five per-class checks now live behind a rule interface, one file each, and the two
guards that decide whether a rule is honest are declared rather than written by hand.

`needs` names a package the project must import before a rule means anything — what `usesRouter` was
for `browser-url`, now a set read once for every rule that will want one. `exempt` names an id prefix
a rule never fires inside, because a rule about reaching past an abstraction is always wrong about
the code that implements it.

No behaviour change: `analyzeProject` and `AnalyzeResult` are unchanged, every issue type is
re-exported from where it was, and the graph a real project produces is byte-identical, hash
included.

The refactor also found that `exempt` had been unreachable since it was written — `needs` fires
first, and `@ramonda/router` does not import itself — so it now has a fixture that reaches it and a
test that fails without it.
