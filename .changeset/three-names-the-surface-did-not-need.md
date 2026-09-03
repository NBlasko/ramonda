---
"@ramonda/router": minor
"@ramonda/check": minor
---

Three exports removed, none of which had a caller

A count of the public surface against everything in this repository that could use
it — both apps, the scaffolder, and both templates — found 99 of 223 names with no
consumer. Most of that is not a finding: `FormState` is a hook a user mounts and
`seedRequest` is called by a user's server, so of course the framework does not
call them itself. Three were different.

**`matchRoute` is removed from `@ramonda/router`.** Nothing called it — not the
router, not the apps, not the templates; its only appearances were its own export
line and its own test. The outlet matches with `matchCompiled`, and `matchRoute`
took an array of pattern strings, which is not a shape anything here produces. It
was a convenience for a shape nobody has.

**`parseUrl` is no longer exported from `@ramonda/router`.** It is
`parseUrlString(location.href)` with the argument taken away, and taking the
argument away is exactly what made it browser-only — the one caveat its
documentation had to carry. The function stays inside the package, where `Router`
uses it for the initial state and for back and forward; a consumer that wants the
URL it is on hands `location.href` to `parseUrlString`.

**`filesOf` is no longer exported from `@ramonda/check`.** The whole
implementation is `new Set(ids.map((id) => id.split("#")[0])).size`, and the fact
it encodes — that a declaration id is `file#name` — is stated on the checker's
page. A caller who wants the count writes the line. It stays internal, for the
CLI's `--split` output.

**And the coverage check now looks both ways.** It could already fail on an
export missing from the API reference; it could not fail on a reference row for
something that is not exported. Removing these three proved why that matters —
one stale row survived the edit and was found by hand. A row's first cell is
read as a claim, and a claim that nothing exports fails the build.

Pre-1.0, so this is a `minor` that removes API. Nothing in this repository used
any of the three.
