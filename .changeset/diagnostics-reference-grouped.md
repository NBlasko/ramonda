---
"@ramonda/query": patch
---

`RMQ001` is documented, and the diagnostics reference is grouped by package.

Reported: `RMQ002` sat between `RMD023` and `RMD024`, so the list read as if it had been sorted and then
broken. It was worse than that — **`RMQ001` was not in the reference at all**, while being raised in two
places in `hashKey.ts`. A message that tells a reader to look up a code, pointing at a page that does not
have it.

The page now has a heading per package (`# Core — RMD`, `# Query — RMQ`) with the general "Reading them"
section lifted above both, and the non-determinism inventory kept beside the RMD codes it explains.
`RMQ001` has its own section: what a function or symbol in a key does (dropped by `JSON.stringify`, so
two different keys hash identically and each query renders the other's data) and what a `Date`, `Map` or
class instance does (serializes unstably, so the entry is never found again and every render refetches).

And the docs build now fails when a diagnostic is raised in the source and missing from the reference —
read from the source rather than from a list somebody maintains, with its own self-test to prove it can
fail. That is the check that was missing when `RMQ001` slipped through.
