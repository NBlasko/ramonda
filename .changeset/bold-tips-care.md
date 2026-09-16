---
"@ramonda/devtools": patch
---

The MIT notice for the icons this package ships now travels with it.

Thirteen SVG paths are copied from Phosphor Icons (MIT). They are written in `@ramonda/theme`, which
is private and publishes nothing — and the devtools panel that draws them is bundled, so the paths
reach this package's `dist` and go to npm. The attribution was a comment in a source file nobody
downloads, which is the copyright notice MIT asks for and not the permission notice.

`THIRD-PARTY.md` ships with the package now, and `scripts/check-third-party.mjs` fails the build if
a published package carries vendored bytes without the notice for them.
