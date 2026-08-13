---
"@ramonda/check": minor
---

Four faults found reviewing the graph work, each reproduced before it was fixed.

**A package's component that provides its own context through a hook was reported as broken.** A
hook is how a component publishes a context for its own subtree, and a fragment records that as a
`uses` edge — the propagation is a rule, not a fact, and the rule ran over this project's own
classes only. So a package judged its `SelfServing` clean and an app that installed it reported the
consumer underneath as having no provider: the same code, two verdicts, and the wrong one is the one
that fails a build. A false positive is the single thing this tool cannot afford.

**Two constants that name each other crashed the run.** `const A = B; const B = A;` is a runtime
error and ordinary syntax; following one into the other while reading a tag's props recursed with
the depth unchanged, so `ramonda-check` died with `Maximum call stack size exceeded` instead of
reporting anything — and every other check in that run died with it.

**A route table built inline lost its edges.** `collectRouteTable` reads `const routes =
createRoutes(…)` and nothing else, but the JSX walk skipped every `createRoutes(…)` call on the
grounds that it was read elsewhere. A table written inside a component was then read by nobody, the
walk stopped there, and every consumer below it went unjudged — silence, which is the failure this
whole design is against. Now only a BOUND table is skipped.

**`ComponentNode.renders` was written in three places and read in none.** The walk moved to a
per-site structure that carries what each call binds to a slot; the old set carried neither and,
left in place, would have handed a later rule a quietly different answer.
