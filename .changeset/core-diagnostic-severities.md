---
"@ramonda/core": patch
---

Diagnostic severities now follow one rule: **error means the end result is wrong; warning means the
result is the same and the app just did more work to get there.**

That matters because the devtools panel raises its alert only for errors, so a fault that produces
wrong output has to be one. Re-graded to **error**:

- **RMD003** — context consumed with no provider above it. The consumer silently gets the default,
  so someone reads and acts on data that is not what the app meant to show.
- **RMD010** — a default host the parent does not allow: the browser rearranges or deletes the
  markup, so the page is not what was written.
- **RMD016** — a component updating while detached: `@destroy` never ran, its timers and listeners
  are still live, and every render goes into nodes nobody can see.
- **RMD017** — a deferred hydration that never resumed. The page looks finished but that subtree
  never becomes interactive.
- **RMD021** — a clock or random read in a `@compute`: the value freezes, and the reader is shown a
  number that stopped moving.
- **RMD023** — components built from an array with no keys: items are matched by position, so state
  lands on the wrong row.
- **RMD025** — per-request data read in the browser: the reader gets nothing where the server had a
  value.

Still warnings, because the outcome is unchanged and only the cost is not: RMD008 (a write after
unmount is dropped, and there is no page left to update), RMD020, RMD022, RMD024.

The rule is now stated in the diagnostics reference, and on the type that carries it.
