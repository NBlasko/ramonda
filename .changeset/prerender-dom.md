---
"create-ramonda": patch
---

A scaffolded SSR project can prerender again.

`server.mjs` was moved from jsdom to linkedom and the scaffolder's dependency list moved with it —
but `scripts/prerender.mjs` was left importing jsdom, which now arrives only with the `testing`
add-on. Without that add-on the project installed, type-checked, built both bundles, and then died
on `ERR_MODULE_NOT_FOUND` at the prerender step.

The two installers are now one file, `installDom.mjs`, imported by both. One file cannot drift from
itself.

Found by scaffolding against the registry and running the build, which nothing automated had done.
A test now reads every `.mjs` the template ships and fails if it imports a package the scaffolder
does not install — the general form of this fault, rather than this one instance of it.
