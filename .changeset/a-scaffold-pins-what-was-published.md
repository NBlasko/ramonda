---
"create-ramonda": patch
---

Rebuilt so a scaffolded project pins the versions this release publishes.

The `@ramonda/*` ranges are not written in the source — `tsup.config.ts` reads them out of the
workspace when the CLI is built. So they only reach npm when this package is itself published, and
`changeset publish` publishes only what has been bumped. Without this, `@ramonda/core` and
`@ramonda/check` would go out while `npm create ramonda` kept pinning the release before them.

Nothing about the CLI's own behaviour changes.
