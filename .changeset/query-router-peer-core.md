---
"@ramonda/query": minor
"@ramonda/router": minor
---

`@ramonda/core` is a **peer** dependency of query and router, not a regular one.

The build already treated it that way — both tsup configs mark it `external`, and the reason
is written next to it: one copy of the framework, or the hook a component uses is not the
hook the app rendered. Core holds module-level state (the update queue, the reactive
context), so two copies is not a duplicate, it is two frameworks that cannot see each
other. The manifest now says what the build has been doing, so the package manager enforces
it instead of leaving it to luck.

It worked by luck until now: `dependencies: { "@ramonda/core": "^0.1.0" }` dedupes to one
copy as long as the app's range agrees. A range that does not agree — an app pinned to
0.1.0 with query resolving 0.2.0, or the reverse — installs both, and the failure is a
component extending a different `Component` than the one rendering it. The docs app's vitest
config carries a measurement of exactly that.

The range is `>=0.1.0 <1.0.0`, spanning the whole pre-1.0 line rather than `^0.1.0`. This is
the trap `@ramonda/testing-library` fell into: a caret on a 0.x version expires on the next
minor, and a peer dependency going out of range is correctly a MAJOR for the dependent — a
0.0.x test helper was about to become 1.0.0 for that reason alone. `.changeset/config.json`
already carries `onlyUpdatePeerDependentsWhenOutOfRange` from that fix, so the two work
together: `changeset status` reports no major.

npm 7+ and pnpm install peers automatically, so nothing changes for a consumer beyond
getting the guarantee.
