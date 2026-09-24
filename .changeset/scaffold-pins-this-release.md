---
"create-ramonda": patch
---

Rebuilt so a scaffolded project pins the versions this release publishes.

The `@ramonda/*` ranges are not written in the source — `tsup.config.ts` reads them out of the
workspace when the CLI is built. So they only reach npm when this package is itself published, and
`changeset publish` publishes only what has been bumped. Without this, `@ramonda/core` would go out
while `npm create ramonda` kept pinning the release before it — and this release is the one where
the `css` prop goes, so a fresh project would scaffold against a core that still has it.

Nothing about the CLI's own behaviour changes.

**And `check-changesets` now refuses the release that forgets it.** This is the second time: the
package has no `@ramonda/*` dependency of its own, so nothing in `changesets` links it to the
packages whose versions it bakes in — `updateInternalDependencies` never reaches it and neither does
`linked`. A rule nobody can see is a rule that gets forgotten, so it is a check now, with a selftest
that plants the fault.
