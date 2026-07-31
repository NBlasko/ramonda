---
"@ramonda/core": patch
---

The SSR smoke test asserted that the machine has an editor, which a CI runner does not.

It called `__open-in-editor` and required a `200`. Opening a file needs an editor, and `launch-editor`
finds one from `$EDITOR` or by guessing from the process table — so a developer with an IDE running got a
`200` and the runner got `500 no editor found`.

What the endpoint is for is resolving the path, and an unresolvable path is refused with `422` **before**
any launch is attempted. So reaching the launch is the proof, and a `500` saying "no editor found" now
passes. To keep that from becoming "accept anything", the test makes a second request for a file that does
not exist and requires the `422` — deleting the server's `existsSync` guard turns that assertion red,
which is how it was checked rather than assumed.

Reproducing a runner locally needs `ps` shadowed as well as `$EDITOR` cleared, since the process-table
guess finds your editor either way. That recipe is in `apps/playground-ssr/README.md`, and the whole gate
was re-run under it: 29/29, 0 cached.
